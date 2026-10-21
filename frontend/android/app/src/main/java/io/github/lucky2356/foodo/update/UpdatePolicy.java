package io.github.lucky2356.foodo.update;

import java.math.BigDecimal;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure update rules for the Android app, without Android dependencies (unit-tested with plain
 * JUnit, see UpdatePolicyTest): which GitHub release may be offered, what its APK must look like,
 * versionCode, redirect, digest and signer comparisons. Network and installation live in
 * UpdateHttp and FoodoUpdaterPlugin; they only act on a {@link Decision} produced here.
 */
public final class UpdatePolicy {

    public static final String OWNER = "Lucky2356";
    public static final String REPO = "Foodo";
    public static final String LATEST_RELEASE_URL =
        "https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/latest";

    /** The release JSON is a few kilobytes; anything above this is refused. */
    public static final int MAX_RELEASE_JSON_BYTES = 2 * 1024 * 1024;
    /** Upper bound for the APK; the current one is a few megabytes. */
    public static final long MAX_APK_BYTES = 150L * 1024 * 1024;
    /** Release notes shown in the app are cut to this many characters. */
    public static final int MAX_NOTES_CHARS = 2000;

    // X.Y.Z without leading zeros. Y and Z below 100 and X below 100000 keep versionCode
    // (X*10000 + Y*100 + Z) monotonic and below Android's limit of 2100000000.
    private static final Pattern SEMVER = Pattern.compile("(0|[1-9]\\d{0,4})\\.(0|[1-9]\\d?)\\.(0|[1-9]\\d?)");
    private static final Pattern DIGEST = Pattern.compile("sha256:([0-9a-f]{64})");

    private UpdatePolicy() {}

    /** A release version X.Y.Z. */
    public static final class Version implements Comparable<Version> {
        public final int major;
        public final int minor;
        public final int patch;

        private Version(int major, int minor, int patch) {
            this.major = major;
            this.minor = minor;
            this.patch = patch;
        }

        /** Parses a strict X.Y.Z; returns null for anything else (suffixes, leading zeros, Y or Z ≥ 100). */
        public static Version parse(String text) {
            if (text == null) {
                return null;
            }
            Matcher m = SEMVER.matcher(text);
            if (!m.matches()) {
                return null;
            }
            return new Version(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
        }

        /** versionCode = X*10000 + Y*100 + Z (also computed in android/app/build.gradle). */
        public int versionCode() {
            return major * 10000 + minor * 100 + patch;
        }

        @Override
        public int compareTo(Version other) {
            if (major != other.major) {
                return Integer.compare(major, other.major);
            }
            if (minor != other.minor) {
                return Integer.compare(minor, other.minor);
            }
            return Integer.compare(patch, other.patch);
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Version && compareTo((Version) o) == 0;
        }

        @Override
        public int hashCode() {
            return versionCode();
        }

        @Override
        public String toString() {
            return major + "." + minor + "." + patch;
        }
    }

    /** versionCode for a version name; throws for an invalid name. */
    public static int versionCode(String versionName) {
        Version v = Version.parse(versionName);
        if (v == null) {
            throw new IllegalArgumentException("Not an X.Y.Z version: " + versionName);
        }
        return v.versionCode();
    }

    public static String assetName(Version v) {
        return "foodo-" + v + ".apk";
    }

    public static String downloadUrl(Version v) {
        return "https://github.com/" + OWNER + "/" + REPO + "/releases/download/v" + v + "/" + assetName(v);
    }

    public static String userAgent(String installedVersionName) {
        return "Foodo-Android/" + installedVersionName;
    }

    /** What to do with the latest release. */
    public enum Status {
        /** A newer release with one valid APK asset. */
        UPDATE_AVAILABLE,
        /** The release is not newer than the installed app. */
        UP_TO_DATE,
        /** Draft or pre-release: never offered. */
        NOT_A_RELEASE,
        /** A newer release whose tag or APK asset does not meet the rules: not offered. */
        INVALID_RELEASE,
    }

    /** The outcome of {@link #decide}. Fields after {@code status} are set only for UPDATE_AVAILABLE. */
    public static final class Decision {
        public final Status status;
        /** Why the release was not offered (English, for logs and tests). */
        public final String detail;
        public final Version version;
        public final String notes;
        public final long size;
        /** Lower-case hex SHA-256 from the asset's GitHub {@code digest}. */
        public final String sha256;
        public final String downloadUrl;

        private Decision(Status status, String detail, Version version, String notes, long size, String sha256, String downloadUrl) {
            this.status = status;
            this.detail = detail;
            this.version = version;
            this.notes = notes;
            this.size = size;
            this.sha256 = sha256;
            this.downloadUrl = downloadUrl;
        }

        static Decision none(Status status, String detail) {
            return new Decision(status, detail, null, null, 0, null, null);
        }

        public boolean isAvailable() {
            return status == Status.UPDATE_AVAILABLE;
        }
    }

    /**
     * Decides whether the release from {@code GET /repos/Lucky2356/Foodo/releases/latest} is an
     * update for the installed version. Only a non-draft, non-prerelease release tagged
     * {@code v<X.Y.Z>} newer than the installed version, with exactly one asset
     * {@code foodo-<X.Y.Z>.apk} (uploaded, 1 byte … 150 MB, {@code digest} "sha256:<64 hex>",
     * download URL exactly {@link #downloadUrl}) is offered.
     *
     * @throws UpdateException BAD_RESPONSE when the JSON is malformed or not an object
     */
    public static Decision decide(String releaseJson, String installedVersionName) throws UpdateException {
        Version installed = Version.parse(installedVersionName);
        if (installed == null) {
            throw new UpdateException(UpdateException.Code.INTERNAL, "Installed version is not X.Y.Z: " + installedVersionName);
        }
        Object parsed = MiniJson.parse(releaseJson);
        if (!(parsed instanceof Map)) {
            throw new UpdateException(UpdateException.Code.BAD_RESPONSE, "Release response is not a JSON object");
        }
        Map<?, ?> release = (Map<?, ?>) parsed;

        if (!Boolean.FALSE.equals(release.get("draft")) || !Boolean.FALSE.equals(release.get("prerelease"))) {
            return Decision.none(Status.NOT_A_RELEASE, "draft or prerelease (or the flags are missing)");
        }
        Object tag = release.get("tag_name");
        Version version = tag instanceof String && ((String) tag).startsWith("v") ? Version.parse(((String) tag).substring(1)) : null;
        if (version == null) {
            return Decision.none(Status.INVALID_RELEASE, "tag is not v<X.Y.Z>: " + tag);
        }
        if (version.compareTo(installed) <= 0) {
            return Decision.none(Status.UP_TO_DATE, "release " + version + " is not newer than " + installed);
        }

        Object assets = release.get("assets");
        if (!(assets instanceof List)) {
            return Decision.none(Status.INVALID_RELEASE, "no assets list");
        }
        String expectedName = assetName(version);
        Map<?, ?> apk = null;
        int matches = 0;
        for (Object item : (List<?>) assets) {
            if (item instanceof Map && expectedName.equals(((Map<?, ?>) item).get("name"))) {
                apk = (Map<?, ?>) item;
                matches++;
            }
        }
        if (matches != 1) {
            return Decision.none(Status.INVALID_RELEASE, "expected exactly one asset " + expectedName + ", found " + matches);
        }

        Object state = apk.get("state");
        if (state != null && !"uploaded".equals(state)) {
            return Decision.none(Status.INVALID_RELEASE, "asset state is " + state);
        }
        long size = integralSize(apk.get("size"));
        if (size < 1 || size > MAX_APK_BYTES) {
            return Decision.none(Status.INVALID_RELEASE, "asset size is missing or outside 1 byte … 150 MB: " + apk.get("size"));
        }
        String sha256 = digestHex(apk.get("digest"));
        if (sha256 == null) {
            return Decision.none(Status.INVALID_RELEASE, "asset digest is not sha256:<64 lower-case hex>: " + apk.get("digest"));
        }
        String expectedUrl = downloadUrl(version);
        if (!expectedUrl.equals(apk.get("browser_download_url"))) {
            return Decision.none(Status.INVALID_RELEASE, "unexpected download URL: " + apk.get("browser_download_url"));
        }
        Object body = release.get("body");
        String notes = truncateNotes(body instanceof String ? (String) body : "");
        return new Decision(Status.UPDATE_AVAILABLE, null, version, notes, size, sha256, expectedUrl);
    }

    /** A JSON number that is a whole number of bytes, or -1. */
    static long integralSize(Object value) {
        if (!(value instanceof BigDecimal)) {
            return -1;
        }
        BigDecimal number = (BigDecimal) value;
        try {
            return number.longValueExact();
        } catch (ArithmeticException e) {
            return -1;
        }
    }

    /** The hex part of a GitHub digest "sha256:<64 lower-case hex>", or null. */
    static String digestHex(Object digest) {
        if (!(digest instanceof String)) {
            return null;
        }
        Matcher m = DIGEST.matcher((String) digest);
        return m.matches() ? m.group(1) : null;
    }

    /** Normalised line breaks, trimmed, cut at {@link #MAX_NOTES_CHARS} without splitting a surrogate pair. */
    public static String truncateNotes(String body) {
        String text = body == null ? "" : body.replace("\r\n", "\n").trim();
        if (text.length() <= MAX_NOTES_CHARS) {
            return text;
        }
        int end = MAX_NOTES_CHARS;
        if (Character.isHighSurrogate(text.charAt(end - 1))) {
            end--;
        }
        return text.substring(0, end).trim() + "…";
    }

    /**
     * Resolves a redirect {@code Location} against the current URL and accepts it only if the
     * result is an absolute https:// URL with a host and without user info. GitHub sends release
     * downloads to its CDN; whatever the host, the file is still checked against the SHA-256
     * digest and the signing certificate before installation.
     *
     * @return the next URL, or null if the redirect must not be followed
     */
    public static URI resolveRedirect(URI current, String location) {
        if (location == null || location.isEmpty()) {
            return null;
        }
        try {
            URI next = current.resolve(new URI(location.trim()));
            String scheme = next.getScheme();
            String host = next.getHost();
            if (scheme == null || !scheme.toLowerCase(Locale.ROOT).equals("https")) {
                return null;
            }
            if (host == null || host.isEmpty() || next.getRawUserInfo() != null) {
                return null;
            }
            return next;
        } catch (URISyntaxException | IllegalArgumentException e) {
            return null;
        }
    }

    public static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    /** Compares a computed SHA-256 with the expected lower-case hex (constant time). */
    public static boolean sha256Matches(String expectedHex, byte[] actual) {
        if (expectedHex == null || actual == null || actual.length != 32) {
            return false;
        }
        return MessageDigest.isEqual(expectedHex.getBytes(StandardCharsets.US_ASCII), toHex(actual).getBytes(StandardCharsets.US_ASCII));
    }

    /**
     * The APK must be signed by exactly the same certificate(s) as the installed app (SHA-256 of
     * each certificate, compared as sets). Empty on either side means "unknown" and fails.
     */
    public static boolean sameSigners(Collection<String> installed, Collection<String> apk) {
        if (installed == null || apk == null || installed.isEmpty() || apk.isEmpty()) {
            return false;
        }
        Set<String> a = new HashSet<>();
        for (String s : installed) {
            a.add(s.toLowerCase(Locale.ROOT));
        }
        Set<String> b = new HashSet<>();
        for (String s : apk) {
            b.add(s.toLowerCase(Locale.ROOT));
        }
        return a.equals(b);
    }

    /** The downloaded APK must carry exactly the versionCode of its tag and be newer than the installed app. */
    public static boolean apkVersionAcceptable(long apkVersionCode, long installedVersionCode, Version expected) {
        return expected != null && apkVersionCode == expected.versionCode() && apkVersionCode > installedVersionCode;
    }
}
