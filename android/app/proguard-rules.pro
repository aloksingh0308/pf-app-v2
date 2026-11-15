# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# --- R8 (android.enableProguardInReleaseBuilds) safety net for native modules that ship
# no consumer rules of their own. RN/Expo/Firebase/Play Services already ship theirs.
-keep class io.invertase.firebase.** { *; }
-keep class io.invertase.googlemobileads.** { *; }
-keep class com.rnmaps.maps.** { *; }
-keep class com.facebook.reactnative.androidsdk.** { *; }
-keep class com.uerceg.play_install_referrer.** { *; }
-keep class com.biometrics.** { *; }
-keep class com.reactnativecommunity.** { *; }
-keep class com.swmansion.** { *; }
-keep class com.th3rdwave.safeareacontext.** { *; }
-keep class com.horcrux.svg.** { *; }
# Keep line numbers so release crash reports stay readable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
