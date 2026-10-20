package io.github.lucky2356.foodo.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/**
 * Release selection for in-app updates. Runs with Gradle (testDebugUnitTest / testReleaseUnitTest)
 * and without the Android SDK (frontend/android/scripts/run-unit-tests.sh).
 */
public class UpdatePolicyTest {

    private static final String DIGEST = "sha256:" + "ab".repeat(32);
    private static final String URL_020 = "https://github.com/Lucky2356/Foodo/releases/download/v0.2.0/foodo-0.2.0.apk";

    /** A release JSON like GitHub's, with fields that individual tests override. */
    private static String release(String tag, boolean draft, boolean prerelease, String assetsJson) {
        return "{\"url\":\"https://api.github.com/repos/Lucky2356/Foodo/releases/1\",\"tag_name\":\"" + tag + "\","
            + "\"name\":\"Foodo\",\"draft\":" + draft + ",\"prerelease\":" + prerelease + ","
            + "\"body\":\"### Добавлено\\r\\n- Android\",\"assets\":" + assetsJson + "}";
    }

    private static String asset(String name, String size, String digest, String url) {
        return "{\"name\":\"" + name + "\",\"state\":\"uploaded\",\"size\":" + size + ",\"digest\":" + digest
            + ",\"content_type\":\"application/vnd.android.package-archive\",\"browser_download_url\":\"" + url + "\"}";
    }

    private static String goodAssets() {
        return "[" + asset("foodo-web-static-0.2.0.zip", "1000", "\"" + DIGEST + "\"", "https://github.com/Lucky2356/Foodo/releases/download/v0.2.0/foodo-web-static-0.2.0.zip")
            + "," + asset("foodo-0.2.0.apk", "5242880", "\"" + DIGEST + "\"", URL_020) + "]";
    }

    private static UpdatePolicy.Decision decide(String json, String installed) {
        try {
            return UpdatePolicy.decide(json, installed);
        } catch (UpdateException e) {
            throw new AssertionError(e);
        }
    }

    private static UpdatePolicy.Status statusFor(String assetsJson) {
        return decide(release("v0.2.0", false, false, assetsJson), "0.1.0").status;
    }

    // --- versions ---

    @Test
    public void versionCodeFollowsTheFormula() {
        assertEquals(100, UpdatePolicy.versionCode("0.1.0"));
        assertEquals(10203, UpdatePolicy.versionCode("1.2.3"));
        assertEquals(999999, UpdatePolicy.versionCode("99.99.99"));
        assertTrue(UpdatePolicy.versionCode("2.0.0") > UpdatePolicy.versionCode("1.99.99"));
        assertTrue(UpdatePolicy.versionCode("0.10.0") > UpdatePolicy.versionCode("0.9.99"));
    }

    @Test
    public void invalidVersionNamesAreRejected() {
        for (String bad : Arrays.asList("1.2", "1.2.3.4", "v1.2.3", "1.2.3-beta", "01.2.3", "1.02.3", "1.100.0", "1.2.100", "", " 1.2.3", "100000.0.0")) {
            assertNull(bad, UpdatePolicy.Version.parse(bad));
            try {
                UpdatePolicy.versionCode(bad);
                fail("accepted " + bad);
            } catch (IllegalArgumentException expected) {
                // ok
            }
        }
        assertNull(UpdatePolicy.Version.parse(null));
    }

    @Test
    public void versionsCompareNumerically() {
        UpdatePolicy.Version a = UpdatePolicy.Version.parse("0.10.0");
        UpdatePolicy.Version b = UpdatePolicy.Version.parse("0.9.0");
        assertTrue(a.compareTo(b) > 0);
        assertEquals(0, UpdatePolicy.Version.parse("1.2.3").compareTo(UpdatePolicy.Version.parse("1.2.3")));
    }

    // --- release selection ---

    @Test
    public void newerReleaseWithValidApkIsOffered() {
        UpdatePolicy.Decision d = decide(release("v0.2.0", false, false, goodAssets()), "0.1.0");
        assertEquals(UpdatePolicy.Status.UPDATE_AVAILABLE, d.status);
        assertTrue(d.isAvailable());
        assertEquals("0.2.0", d.version.toString());
        assertEquals(5242880L, d.size);
        assertEquals("ab".repeat(32), d.sha256);
        assertEquals(URL_020, d.downloadUrl);
        assertEquals("### Добавлено\n- Android", d.notes);
    }

    @Test
    public void equalOrOlderReleaseIsNotOffered() {
        assertEquals(UpdatePolicy.Status.UP_TO_DATE, decide(release("v0.2.0", false, false, goodAssets()), "0.2.0").status);
        assertEquals(UpdatePolicy.Status.UP_TO_DATE, decide(release("v0.2.0", false, false, goodAssets()), "0.3.0").status);
        assertEquals(UpdatePolicy.Status.UP_TO_DATE, decide(release("v0.2.0", false, false, goodAssets()), "1.0.0").status);
    }

    @Test
    public void numericComparisonNotLexical() {
        String assets = "[" + asset("foodo-0.10.0.apk", "10", "\"" + DIGEST + "\"", "https://github.com/Lucky2356/Foodo/releases/download/v0.10.0/foodo-0.10.0.apk") + "]";
        assertTrue(decide(release("v0.10.0", false, false, assets), "0.9.0").isAvailable());
    }

    @Test
    public void draftsAndPrereleasesAreSkipped() {
        assertEquals(UpdatePolicy.Status.NOT_A_RELEASE, decide(release("v0.2.0", false, true, goodAssets()), "0.1.0").status);
        assertEquals(UpdatePolicy.Status.NOT_A_RELEASE, decide(release("v0.2.0", true, false, goodAssets()), "0.1.0").status);
        // Missing flags are not treated as "false".
        assertEquals(UpdatePolicy.Status.NOT_A_RELEASE, decide("{\"tag_name\":\"v0.2.0\",\"assets\":" + goodAssets() + "}", "0.1.0").status);
    }

    @Test
    public void badTagsAreRejected() {
        for (String tag : Arrays.asList("0.2.0", "v0.2", "v0.2.0-rc.1", "release-0.2.0", "V0.2.0", "v00.2.0")) {
            assertEquals(tag, UpdatePolicy.Status.INVALID_RELEASE, decide(release(tag, false, false, goodAssets()), "0.1.0").status);
        }
    }

    @Test
    public void wrongAssetNameIsRejected() {
        assertEquals(UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + asset("app-release.apk", "10", "\"" + DIGEST + "\"", URL_020) + "]"));
        assertEquals(UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + asset("foodo-0.2.0-debug.apk", "10", "\"" + DIGEST + "\"", URL_020) + "]"));
        assertEquals(UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + asset("Foodo-0.2.0.apk", "10", "\"" + DIGEST + "\"", URL_020) + "]"));
        // An APK named after another version.
        assertEquals(UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + asset("foodo-0.1.9.apk", "10", "\"" + DIGEST + "\"", URL_020) + "]"));
        assertEquals(UpdatePolicy.Status.INVALID_RELEASE, statusFor("[]"));
    }

    @Test
    public void duplicateApkAssetIsRejected() {
        String one = asset("foodo-0.2.0.apk", "10", "\"" + DIGEST + "\"", URL_020);
        assertEquals(UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + one + "," + one + "]"));
    }

    @Test
    public void badDigestIsRejected() {
        for (String digest : Arrays.asList(
            "null",
            "\"\"",
            "\"" + "ab".repeat(32) + "\"",
            "\"sha512:" + "ab".repeat(32) + "\"",
            "\"sha256:" + "AB".repeat(32) + "\"",
            "\"sha256:" + "ab".repeat(31) + "a\"",
            "\"sha256:" + "ab".repeat(32) + "0\"",
            "\"sha256:" + "zz".repeat(32) + "\"",
            "\" sha256:" + "ab".repeat(32) + "\"",
            "42")) {
            assertEquals(digest, UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + asset("foodo-0.2.0.apk", "10", digest, URL_020) + "]"));
        }
    }

    @Test
    public void downloadUrlMustMatchExactly() {
        for (String url : Arrays.asList(
            "http://github.com/Lucky2356/Foodo/releases/download/v0.2.0/foodo-0.2.0.apk",
            "https://evil.example/Lucky2356/Foodo/releases/download/v0.2.0/foodo-0.2.0.apk",
            "https://github.com.evil.example/Lucky2356/Foodo/releases/download/v0.2.0/foodo-0.2.0.apk",
            "https://github.com/Other/Foodo/releases/download/v0.2.0/foodo-0.2.0.apk",
            "https://github.com/lucky2356/foodo/releases/download/v0.2.0/foodo-0.2.0.apk",
            "https://github.com/Lucky2356/Foodo/releases/download/v0.1.0/foodo-0.2.0.apk",
            "https://github.com/Lucky2356/Foodo/releases/download/v0.2.0/foodo-0.2.0.apk?x=1",
            "https://user@github.com/Lucky2356/Foodo/releases/download/v0.2.0/foodo-0.2.0.apk",
            "https://github.com/Lucky2356/Foodo/releases/download/v0.2.0/../v0.2.0/foodo-0.2.0.apk")) {
            assertEquals(url, UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + asset("foodo-0.2.0.apk", "10", "\"" + DIGEST + "\"", url) + "]"));
        }
    }

    @Test
    public void sizeLimits() {
        long max = 150L * 1024 * 1024;
        assertEquals(UpdatePolicy.Status.UPDATE_AVAILABLE, statusFor("[" + asset("foodo-0.2.0.apk", "1", "\"" + DIGEST + "\"", URL_020) + "]"));
        assertEquals(UpdatePolicy.Status.UPDATE_AVAILABLE, statusFor("[" + asset("foodo-0.2.0.apk", String.valueOf(max), "\"" + DIGEST + "\"", URL_020) + "]"));
        for (String size : Arrays.asList("0", "-1", String.valueOf(max + 1), "1.5", "\"10\"", "null", "1e400", "99999999999999999999")) {
            assertEquals(size, UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + asset("foodo-0.2.0.apk", size, "\"" + DIGEST + "\"", URL_020) + "]"));
        }
        // 1.0e2 is a whole number of bytes written in exponent form.
        assertEquals(UpdatePolicy.Status.UPDATE_AVAILABLE, statusFor("[" + asset("foodo-0.2.0.apk", "1.0e2", "\"" + DIGEST + "\"", URL_020) + "]"));
    }

    @Test
    public void incompleteUploadIsRejected() {
        String starter = asset("foodo-0.2.0.apk", "10", "\"" + DIGEST + "\"", URL_020).replace("\"uploaded\"", "\"starter\"");
        assertEquals(UpdatePolicy.Status.INVALID_RELEASE, statusFor("[" + starter + "]"));
    }

    @Test
    public void notesAreTruncated() {
        String longBody = "я".repeat(UpdatePolicy.MAX_NOTES_CHARS + 50);
        String json = release("v0.2.0", false, false, goodAssets()).replace("\"### Добавлено\\r\\n- Android\"", "\"" + longBody + "\"");
        UpdatePolicy.Decision d = decide(json, "0.1.0");
        assertEquals(UpdatePolicy.MAX_NOTES_CHARS + 1, d.notes.length());
        assertTrue(d.notes.endsWith("…"));
        assertEquals("", UpdatePolicy.truncateNotes(null));
        // A surrogate pair at the cut is not split.
        String emoji = "a".repeat(UpdatePolicy.MAX_NOTES_CHARS - 1) + "\uD83C\uDF72" + "b";
        String cut = UpdatePolicy.truncateNotes(emoji);
        assertFalse(Character.isHighSurrogate(cut.charAt(cut.length() - 2)));
        String nullBody = release("v0.2.0", false, false, goodAssets()).replace("\"### Добавлено\\r\\n- Android\"", "null");
        assertEquals("", decide(nullBody, "0.1.0").notes);
    }

    @Test
    public void malformedJsonIsAnError() {
        for (String bad : Arrays.asList("", "[]", "\"x\"", "{", "{\"a\":1,}", "{\"a\":1} x", "{'a':1}", "{\"a\":01}", "{\"a\":1,\"a\":2}", "{\"a\":\"\u0001\"}", "{\"a\":\"\\x\"}")) {
            try {
                UpdatePolicy.decide(bad, "0.1.0");
                fail("accepted " + bad);
            } catch (UpdateException e) {
                assertEquals(bad, UpdateException.Code.BAD_RESPONSE, e.getCode());
            }
        }
        String deep = "[".repeat(MiniJson.MAX_DEPTH + 5) + "]".repeat(MiniJson.MAX_DEPTH + 5);
        try {
            UpdatePolicy.decide(deep, "0.1.0");
            fail("accepted deep nesting");
        } catch (UpdateException e) {
            assertEquals(UpdateException.Code.BAD_RESPONSE, e.getCode());
        }
    }

    @Test
    public void invalidInstalledVersionIsAnInternalError() {
        try {
            UpdatePolicy.decide(release("v0.2.0", false, false, goodAssets()), "dev");
            fail("accepted dev");
        } catch (UpdateException e) {
            assertEquals(UpdateException.Code.INTERNAL, e.getCode());
        }
    }

    @Test
    public void jsonEscapesAreDecoded() throws UpdateException {
        Object parsed = MiniJson.parse("{\"s\":\"\\u0410\\n\\\"\\/\",\"n\":[1,-2.5e1,true,false,null]}");
        java.util.Map<?, ?> map = (java.util.Map<?, ?>) parsed;
        assertEquals("А\n\"/", map.get("s"));
        assertEquals(5, ((java.util.List<?>) map.get("n")).size());
    }

    // --- download and installation checks ---

    @Test
    public void redirectsMustStayOnHttps() {
        URI start = URI.create(URL_020);
        URI cdn = UpdatePolicy.resolveRedirect(start, "https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=x");
        assertNotNull(cdn);
        assertEquals("release-assets.githubusercontent.com", cdn.getHost());
        assertEquals("https://github.com/Lucky2356/Foodo/releases/x.apk", UpdatePolicy.resolveRedirect(start, "/Lucky2356/Foodo/releases/x.apk").toString());
        assertNull(UpdatePolicy.resolveRedirect(start, "http://objects.githubusercontent.com/x"));
        assertNull(UpdatePolicy.resolveRedirect(start, "ftp://example.com/x"));
        assertNull(UpdatePolicy.resolveRedirect(start, "https://user:pw@example.com/x"));
        assertNull(UpdatePolicy.resolveRedirect(start, "https:///nohost"));
        assertNull(UpdatePolicy.resolveRedirect(start, ""));
        assertNull(UpdatePolicy.resolveRedirect(start, null));
        assertNull(UpdatePolicy.resolveRedirect(start, "https://exa mple.com/"));
    }

    @Test
    public void sha256Comparison() throws Exception {
        byte[] data = "foodo".getBytes(StandardCharsets.UTF_8);
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        String hex = UpdatePolicy.toHex(digest);
        assertEquals(64, hex.length());
        assertTrue(UpdatePolicy.sha256Matches(hex, digest));
        assertFalse(UpdatePolicy.sha256Matches(hex.toUpperCase(), digest));
        assertFalse(UpdatePolicy.sha256Matches("00".repeat(32), digest));
        assertFalse(UpdatePolicy.sha256Matches(null, digest));
        assertFalse(UpdatePolicy.sha256Matches(hex, new byte[31]));
    }

    @Test
    public void signersMustBeTheSameSet() {
        assertTrue(UpdatePolicy.sameSigners(Collections.singletonList("aa"), Collections.singletonList("AA")));
        assertFalse(UpdatePolicy.sameSigners(Collections.singletonList("aa"), Collections.singletonList("bb")));
        assertFalse(UpdatePolicy.sameSigners(Collections.singletonList("aa"), Arrays.asList("aa", "bb")));
        assertFalse(UpdatePolicy.sameSigners(Collections.emptyList(), Collections.emptyList()));
        assertFalse(UpdatePolicy.sameSigners(Collections.singletonList("aa"), null));
    }

    @Test
    public void apkVersionMustMatchTagAndBeNewer() {
        UpdatePolicy.Version v = UpdatePolicy.Version.parse("0.2.0");
        assertTrue(UpdatePolicy.apkVersionAcceptable(200, 100, v));
        assertFalse(UpdatePolicy.apkVersionAcceptable(201, 100, v));
        assertFalse(UpdatePolicy.apkVersionAcceptable(200, 200, v));
        assertFalse(UpdatePolicy.apkVersionAcceptable(200, 300, v));
        assertFalse(UpdatePolicy.apkVersionAcceptable(200, 100, null));
    }

    @Test
    public void userAgentAndUrls() {
        assertEquals("Foodo-Android/0.1.0", UpdatePolicy.userAgent("0.1.0"));
        assertEquals("https://api.github.com/repos/Lucky2356/Foodo/releases/latest", UpdatePolicy.LATEST_RELEASE_URL);
        assertEquals(URL_020, UpdatePolicy.downloadUrl(UpdatePolicy.Version.parse("0.2.0")));
    }
}
