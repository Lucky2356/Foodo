package io.github.lucky2356.foodo.update;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;
import java.io.File;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/**
 * Checks a downloaded APK with PackageManager before it is handed to the installer: same package
 * name, versionCode equal to its tag and newer than the installed app, and signed by the same
 * certificate as the installed app. Android performs the signature check again when installing;
 * this one fails earlier, with a clear message, and never starts an installer for a foreign APK.
 */
final class ApkVerifier {

    private ApkVerifier() {}

    static void verify(Context context, File apk, UpdatePolicy.Decision update) throws UpdateException {
        PackageManager pm = context.getPackageManager();
        String ownPackage = context.getPackageName();
        PackageInfo archive = archiveInfo(pm, apk.getAbsolutePath());
        if (archive == null) {
            throw fail("PackageManager cannot read the downloaded file as an APK");
        }
        if (!ownPackage.equals(archive.packageName)) {
            throw fail("APK package " + archive.packageName + " differs from " + ownPackage);
        }
        PackageInfo installed;
        try {
            installed = installedInfo(pm, ownPackage);
        } catch (PackageManager.NameNotFoundException e) {
            throw new UpdateException(UpdateException.Code.INTERNAL, "Own package not found", e);
        }
        if (!UpdatePolicy.apkVersionAcceptable(versionCode(archive), versionCode(installed), update.version)) {
            throw fail("APK versionCode " + versionCode(archive) + " is not " + update.version.versionCode() + " or not newer than " + versionCode(installed));
        }
        List<String> apkSigners = signers(archive);
        if (apkSigners.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Defensive: if signingInfo is empty for the archive, try the legacy field. If both are
            // empty, sameSigners() fails and nothing is installed.
            apkSigners = signers(legacyArchiveInfo(pm, apk.getAbsolutePath()));
        }
        if (!UpdatePolicy.sameSigners(signers(installed), apkSigners)) {
            throw fail("APK signing certificate differs from the installed app");
        }
    }

    private static UpdateException fail(String message) {
        return new UpdateException(UpdateException.Code.VERIFY_FAILED, message);
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo archiveInfo(PackageManager pm, String path) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageArchiveInfo(path, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES));
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES);
        }
        return pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES);
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo legacyArchiveInfo(PackageManager pm, String path) {
        return pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES);
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo installedInfo(PackageManager pm, String packageName) throws PackageManager.NameNotFoundException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES));
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
        }
        return pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES);
    }

    @SuppressWarnings("deprecation")
    static long versionCode(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.getLongVersionCode();
        }
        return info.versionCode;
    }

    /** SHA-256 (hex) of each current signing certificate; empty if unknown. */
    @SuppressWarnings("deprecation")
    private static List<String> signers(PackageInfo info) throws UpdateException {
        List<String> result = new ArrayList<>();
        if (info == null) {
            return result;
        }
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            SigningInfo signingInfo = info.signingInfo;
            // The current signer(s) of the APK contents, without past certificates of a rotation.
            signatures = signingInfo.getApkContentsSigners();
        }
        if ((signatures == null || signatures.length == 0) && info.signatures != null) {
            signatures = info.signatures;
        }
        if (signatures == null) {
            return result;
        }
        for (Signature signature : signatures) {
            MessageDigest sha256 = UpdateHttp.sha256();
            result.add(UpdatePolicy.toHex(sha256.digest(signature.toByteArray())));
        }
        return result;
    }
}
