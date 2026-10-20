# R8 rules for the release APK (minifyEnabled true in app/build.gradle).
#
# Capacitor finds plugins and their methods by reflection and annotations, and the web page calls
# into Java through @JavascriptInterface. Capacitor's own consumer rules keep plugin classes; the
# rules below are deliberately broad on top of that: Capacitor and the app's code are small, so
# keeping them whole costs little and avoids a release-only failure that the debug build would
# not show. R8 still shrinks the AndroidX and Cordova libraries.

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Capacitor bridge, plugins and the JavaScript interface.
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Foodo's plugins (FoodoUpdater, FoodoFiles), the install-status receiver and the update logic.
-keep class io.github.lucky2356.foodo.** { *; }

# Readable stack traces in crash reports without exposing the original file names.
-renamesourcefileattribute SourceFile
