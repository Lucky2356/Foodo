package io.github.lucky2356.foodo.files;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Saving exports (JSON backup, PDF, XLSX) from the WebView. Android's WebView ignores
 * {@code <a download>} for blob: URLs, so the web app passes the file here and the user picks the
 * place in the system «Сохранить» dialog (Storage Access Framework). No storage permission is
 * needed and the app gets access only to the one file the user creates.
 */
@CapacitorPlugin(name = "FoodoFiles")
public class FoodoFilesPlugin extends Plugin {

    private static final String TAG = "FoodoFiles";
    /** Exports are well below this; the limit keeps a broken call from exhausting memory. */
    private static final int MAX_BYTES = 32 * 1024 * 1024;
    private static final Set<String> ALLOWED_TYPES = new HashSet<>(
        Arrays.asList("application/json", "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    );

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        worker.shutdown();
    }

    @PluginMethod
    public void save(PluginCall call) {
        String filename = safeName(call.getString("filename"));
        String mimeType = call.getString("mimeType");
        String data = call.getString("base64");
        if (filename == null || mimeType == null || !ALLOWED_TYPES.contains(mimeType) || data == null) {
            call.reject("Invalid file", "INVALID");
            return;
        }
        // base64 is 4/3 of the size; check before decoding.
        if ((long) data.length() * 3 / 4 > MAX_BYTES) {
            call.reject("File too large", "TOO_LARGE");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "onSaveLocationChosen");
    }

    @ActivityCallback
    private void onSaveLocationChosen(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent resultData = result.getData();
        Uri uri = resultData == null ? null : resultData.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("saved", false);
            call.resolve(cancelled);
            getBridge().releaseCall(call);
            return;
        }
        worker.execute(() -> {
            try {
                byte[] bytes = Base64.decode(call.getString("base64"), Base64.DEFAULT);
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) {
                        throw new IOException("No output stream for the chosen file");
                    }
                    out.write(bytes);
                }
                JSObject saved = new JSObject();
                saved.put("saved", true);
                call.resolve(saved);
            } catch (IOException | IllegalArgumentException | SecurityException e) {
                Logger.error(TAG, "Saving failed", e);
                call.reject("Could not write the file", "WRITE_FAILED");
            } finally {
                // startActivityForResult saved the call (with the file data); free it.
                getBridge().releaseCall(call);
            }
        });
    }

    /** A plain file name: no path separators or control characters, at most 120 characters. */
    static String safeName(String name) {
        if (name == null) {
            return null;
        }
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (cleaned.isEmpty() || cleaned.equals(".") || cleaned.equals("..")) {
            return null;
        }
        return cleaned.length() > 120 ? cleaned.substring(cleaned.length() - 120) : cleaned;
    }
}
