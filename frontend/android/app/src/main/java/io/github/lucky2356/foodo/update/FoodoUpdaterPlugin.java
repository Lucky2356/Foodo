package io.github.lucky2356.foodo.update;

import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.lucky2356.foodo.BuildConfig;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app updates from GitHub Releases (docs/ANDROID.md).
 *
 * <p>check() asks the GitHub API anonymously for the latest release and keeps the result only if
 * UpdatePolicy accepts it. download() fetches exactly that APK (the URL never comes from
 * JavaScript), checks size and SHA-256 against the release digest, then package name, versionCode
 * and signing certificate with PackageManager. install() hands the verified file to
 * PackageInstaller; Android shows its own confirmation and checks the signature again.
 */
@CapacitorPlugin(name = "FoodoUpdater")
public class FoodoUpdaterPlugin extends Plugin {

    private static final String TAG = "FoodoUpdater";
    private static final String UPDATES_DIR = "updates";

    private static volatile WeakReference<FoodoUpdaterPlugin> active = new WeakReference<>(null);

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    /** The release accepted by the last check(); download() uses only this. */
    private volatile UpdatePolicy.Decision pending;
    /** The APK that passed all checks, and the release it belongs to. */
    private volatile File verifiedApk;
    private volatile UpdatePolicy.Decision verifiedFor;

    @Override
    public void load() {
        active = new WeakReference<>(this);
        // Updates replace the app, so any file left in updates/ is from an earlier run.
        worker.execute(() -> clearUpdatesDir(null));
    }

    @Override
    protected void handleOnDestroy() {
        cancelled.set(true);
        if (active.get() == this) {
            active = new WeakReference<>(null);
        }
        worker.shutdownNow();
    }

    private static String userAgent() {
        return UpdatePolicy.userAgent(BuildConfig.VERSION_NAME);
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        // Android 7.x: the system installer asks about unknown sources itself.
        return true;
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("versionName", BuildConfig.VERSION_NAME);
        result.put("versionCode", BuildConfig.VERSION_CODE);
        result.put("canInstall", canInstallPackages());
        call.resolve(result);
    }

    @PluginMethod
    public void check(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("Another update operation is running", UpdateException.Code.BUSY.name());
            return;
        }
        worker.execute(() -> {
            try {
                String json = UpdateHttp.fetchLatestRelease(userAgent());
                JSObject result = new JSObject();
                if (json == null) {
                    pending = null;
                    result.put("available", false);
                    result.put("reason", "no_release");
                    call.resolve(result);
                    return;
                }
                UpdatePolicy.Decision decision = UpdatePolicy.decide(json, BuildConfig.VERSION_NAME);
                if (!decision.isAvailable()) {
                    pending = null;
                    Logger.info(TAG, "No update: " + decision.status + " " + decision.detail);
                    result.put("available", false);
                    result.put("reason", decision.status.name().toLowerCase(Locale.ROOT));
                    call.resolve(result);
                    return;
                }
                pending = decision;
                result.put("available", true);
                result.put("version", decision.version.toString());
                result.put("notes", decision.notes);
                result.put("size", decision.size);
                call.resolve(result);
            } catch (UpdateException e) {
                reject(call, e);
            } catch (RuntimeException e) {
                reject(call, new UpdateException(UpdateException.Code.INTERNAL, "check failed", e));
            } finally {
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        final UpdatePolicy.Decision update = pending;
        if (update == null) {
            call.reject("Run check() first", UpdateException.Code.NO_UPDATE.name());
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Another update operation is running", UpdateException.Code.BUSY.name());
            return;
        }
        cancelled.set(false);
        worker.execute(() -> {
            File dir = new File(getContext().getCacheDir(), UPDATES_DIR);
            File target = new File(dir, UpdatePolicy.assetName(update.version));
            try {
                verifiedApk = null;
                verifiedFor = null;
                clearUpdatesDir(null);
                if (!dir.isDirectory() && !dir.mkdirs()) {
                    throw new UpdateException(UpdateException.Code.INTERNAL, "Cannot create the updates directory");
                }
                UpdateHttp.download(update, target, userAgent(), (downloaded, total) -> {
                    JSObject progress = new JSObject();
                    progress.put("downloaded", downloaded);
                    progress.put("total", total);
                    notifyListeners("downloadProgress", progress);
                }, cancelled);
                ApkVerifier.verify(getContext(), target, update);
                verifiedApk = target;
                verifiedFor = update;
                JSObject result = new JSObject();
                result.put("version", update.version.toString());
                call.resolve(result);
            } catch (UpdateException e) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                reject(call, e);
            } catch (RuntimeException e) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                reject(call, new UpdateException(UpdateException.Code.INTERNAL, "download failed", e));
            } finally {
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        final File apk = verifiedApk;
        final UpdatePolicy.Decision update = verifiedFor;
        if (apk == null || update == null) {
            call.reject("No verified update has been downloaded", UpdateException.Code.NO_UPDATE.name());
            return;
        }
        if (!canInstallPackages()) {
            call.reject("Installing apps from this source is not allowed", UpdateException.Code.INSTALL_PERMISSION.name());
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Another update operation is running", UpdateException.Code.BUSY.name());
            return;
        }
        worker.execute(() -> {
            try {
                startInstallSession(apk, update);
                JSObject result = new JSObject();
                result.put("started", true);
                call.resolve(result);
            } catch (UpdateException e) {
                reject(call, e);
            } catch (RuntimeException e) {
                reject(call, new UpdateException(UpdateException.Code.INSTALL_FAILED, "install failed", e));
            } finally {
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Context context = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName())));
            } catch (ActivityNotFoundException e2) {
                call.reject("No settings screen available", UpdateException.Code.INTERNAL.name());
                return;
            }
        }
        call.resolve();
    }

    /**
     * Streams the verified APK into a PackageInstaller session, re-computing SHA-256 on the way so
     * the bytes that are installed are exactly the ones that were verified.
     */
    private void startInstallSession(File apk, UpdatePolicy.Decision update) throws UpdateException {
        Context context = getContext();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Always show Android's confirmation; the user decides about every update.
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        }
        int sessionId;
        try {
            sessionId = installer.createSession(params);
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Code.INSTALL_FAILED, "Cannot create an install session", e);
        }
        boolean committed = false;
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            MessageDigest sha256 = UpdateHttp.sha256();
            long written = 0;
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("foodo.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    sha256.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    written += n;
                }
                session.fsync(out);
            }
            if (written != update.size || !UpdatePolicy.sha256Matches(update.sha256, sha256.digest())) {
                throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "APK changed after verification");
            }
            Intent status = new Intent(context, UpdateStatusReceiver.class).setAction(UpdateStatusReceiver.ACTION).setPackage(context.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // PackageInstaller adds the result extras, so the explicit intent must be mutable.
                flags |= PendingIntent.FLAG_MUTABLE;
            }
            PendingIntent callback = PendingIntent.getBroadcast(context, sessionId, status, flags);
            session.commit(callback.getIntentSender());
            committed = true;
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Code.INSTALL_FAILED, "Cannot write the install session", e);
        } finally {
            if (!committed) {
                try {
                    installer.abandonSession(sessionId);
                } catch (SecurityException e) {
                    Logger.warn(TAG, "abandonSession failed: " + e.getMessage());
                }
            }
        }
    }

    /** Called by UpdateStatusReceiver with the PackageInstaller result. */
    static void reportInstallStatus(String status, String message) {
        FoodoUpdaterPlugin plugin = active.get();
        if (plugin == null) {
            return;
        }
        JSObject event = new JSObject();
        event.put("status", status);
        if (message != null) {
            event.put("message", message);
        }
        plugin.notifyListeners("installStatus", event);
    }

    private void clearUpdatesDir(File keep) {
        File[] files = new File(getContext().getCacheDir(), UPDATES_DIR).listFiles();
        if (files == null) {
            return;
        }
        for (File file : files) {
            if (!file.equals(keep)) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
    }

    private static void reject(PluginCall call, UpdateException e) {
        Logger.error(TAG, e.getCode() + ": " + e.getMessage(), e.getCause());
        call.reject(e.getMessage(), e.getCode().name());
    }
}
