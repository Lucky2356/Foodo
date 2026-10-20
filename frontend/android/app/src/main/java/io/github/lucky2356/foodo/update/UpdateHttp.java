package io.github.lucky2356.foodo.update;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/**
 * HTTPS requests of the updater (plain java.net, no Android dependencies): the anonymous GitHub
 * release request and the APK download with size and SHA-256 checks. Nothing here installs
 * anything; the caller verifies the APK's package and signature afterwards.
 */
public final class UpdateHttp {

    static final int CONNECT_TIMEOUT_MS = 15_000;
    static final int READ_TIMEOUT_MS = 30_000;
    static final int MAX_REDIRECTS = 5;

    /** Download progress, reported at most every percent. */
    public interface Progress {
        void onProgress(long downloaded, long total);
    }

    private UpdateHttp() {}

    /** GET /repos/Lucky2356/Foodo/releases/latest without credentials; null when there is no release (404). */
    public static String fetchLatestRelease(String userAgent) throws UpdateException {
        HttpsURLConnection connection = open(URI.create(UpdatePolicy.LATEST_RELEASE_URL), userAgent);
        try {
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
            int status = connection.getResponseCode();
            if (status == 404) {
                return null;
            }
            if (status == 403 || status == 429) {
                throw new UpdateException(UpdateException.Code.RATE_LIMIT, "GitHub API refused the request: HTTP " + status);
            }
            if (status != 200) {
                throw new UpdateException(UpdateException.Code.HTTP, "GitHub API: HTTP " + status);
            }
            long declared = connection.getContentLengthLong();
            if (declared > UpdatePolicy.MAX_RELEASE_JSON_BYTES) {
                throw new UpdateException(UpdateException.Code.BAD_RESPONSE, "Release response too large: " + declared);
            }
            try (InputStream in = connection.getInputStream()) {
                return new String(readCapped(in, UpdatePolicy.MAX_RELEASE_JSON_BYTES), StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Code.NETWORK, "GitHub API request failed", e);
        } finally {
            connection.disconnect();
        }
    }

    /**
     * Downloads the APK of an available update into {@code target}. Follows at most
     * {@link #MAX_REDIRECTS} https-only redirects, aborts as soon as more bytes arrive than the
     * release declares, and accepts the file only if its size and SHA-256 equal the release data.
     * On any failure the partial file is deleted.
     */
    public static void download(UpdatePolicy.Decision update, File target, String userAgent, Progress progress, AtomicBoolean cancelled)
        throws UpdateException {
        if (update == null || !update.isAvailable()) {
            throw new UpdateException(UpdateException.Code.NO_UPDATE, "No verified update to download");
        }
        File partial = new File(target.getPath() + ".part");
        HttpsURLConnection connection = null;
        boolean ok = false;
        try {
            URI uri = URI.create(update.downloadUrl);
            for (int hop = 0; ; hop++) {
                connection = open(uri, userAgent);
                connection.setRequestProperty("Accept", "application/octet-stream");
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    URI next = UpdatePolicy.resolveRedirect(uri, connection.getHeaderField("Location"));
                    connection.disconnect();
                    connection = null;
                    if (next == null || hop + 1 > MAX_REDIRECTS) {
                        throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "Refused redirect from " + uri.getHost());
                    }
                    uri = next;
                    continue;
                }
                if (status == 403 || status == 429) {
                    throw new UpdateException(UpdateException.Code.RATE_LIMIT, "Download refused: HTTP " + status);
                }
                if (status != 200) {
                    throw new UpdateException(UpdateException.Code.HTTP, "Download: HTTP " + status);
                }
                break;
            }
            long declared = connection.getContentLengthLong();
            if (declared >= 0 && declared != update.size) {
                throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "Content-Length " + declared + " differs from the release size " + update.size);
            }
            MessageDigest sha256 = sha256();
            long total = 0;
            int lastPercent = -1;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (cancelled != null && cancelled.get()) {
                        throw new UpdateException(UpdateException.Code.NETWORK, "Download cancelled");
                    }
                    total += n;
                    if (total > update.size) {
                        throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "More data than the release declares");
                    }
                    sha256.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    int percent = (int) (total * 100 / update.size);
                    if (progress != null && percent != lastPercent) {
                        lastPercent = percent;
                        progress.onProgress(total, update.size);
                    }
                }
            }
            if (total != update.size) {
                throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "Downloaded " + total + " bytes, expected " + update.size);
            }
            if (!UpdatePolicy.sha256Matches(update.sha256, sha256.digest())) {
                throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "SHA-256 differs from the release digest");
            }
            if (target.exists() && !target.delete()) {
                throw new UpdateException(UpdateException.Code.INTERNAL, "Cannot replace " + target.getName());
            }
            if (!partial.renameTo(target)) {
                throw new UpdateException(UpdateException.Code.INTERNAL, "Cannot move the downloaded file");
            }
            ok = true;
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Code.NETWORK, "Download failed", e);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
            if (!ok) {
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
            }
        }
    }

    /** Re-checks a file on disk against the expected size and SHA-256. */
    public static void verifyFile(File file, long expectedSize, String expectedSha256) throws UpdateException {
        if (!file.isFile() || file.length() != expectedSize) {
            throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "Downloaded file is missing or has a different size");
        }
        MessageDigest sha256 = sha256();
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) {
                sha256.update(buffer, 0, n);
            }
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "Cannot read the downloaded file", e);
        }
        if (!UpdatePolicy.sha256Matches(expectedSha256, sha256.digest())) {
            throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "SHA-256 of the downloaded file changed");
        }
    }

    public static MessageDigest sha256() throws UpdateException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new UpdateException(UpdateException.Code.INTERNAL, "SHA-256 unavailable", e);
        }
    }

    private static HttpsURLConnection open(URI uri, String userAgent) throws UpdateException {
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "Only https:// is allowed");
        }
        try {
            URL url = uri.toURL();
            HttpURLConnection plain = (HttpURLConnection) url.openConnection();
            if (!(plain instanceof HttpsURLConnection)) {
                plain.disconnect();
                throw new UpdateException(UpdateException.Code.VERIFY_FAILED, "Not an HTTPS connection");
            }
            HttpsURLConnection connection = (HttpsURLConnection) plain;
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("User-Agent", userAgent);
            return connection;
        } catch (IOException | IllegalArgumentException e) {
            throw new UpdateException(UpdateException.Code.NETWORK, "Cannot open " + uri.getHost(), e);
        }
    }

    static byte[] readCapped(InputStream in, int maxBytes) throws IOException, UpdateException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int n;
        while ((n = in.read(buffer)) != -1) {
            if (out.size() + n > maxBytes) {
                throw new UpdateException(UpdateException.Code.BAD_RESPONSE, "Release response exceeds " + maxBytes + " bytes");
            }
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }
}
