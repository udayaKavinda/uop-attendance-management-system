# Default ProGuard rules. Minification is disabled for the release build, but
# these keeps make it safe to turn on later.

# Retrofit
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keep,allowobfuscation interface retrofit2.Call
-keep,allowobfuscation class retrofit2.Response
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**

# Moshi (reflection-based adapters)
-keep class com.squareup.moshi.** { *; }
-keep @com.squareup.moshi.JsonClass class * { *; }
-keepclassmembers class * {
    @com.squareup.moshi.Json <fields>;
}

# Keep our DTOs so Moshi's reflective adapter can read field names.
-keep class lk.ac.pdn.eng.feats.data.net.** { *; }

# Kotlin metadata for reflection
-keep class kotlin.Metadata { *; }

# Credential Manager / Sign in with Google.
# The androidx.credentials and googleid artifacts ship consumer rules, but the
# credential providers are resolved reflectively, so keep them explicitly —
# release builds have isMinifyEnabled = true.
-keep class androidx.credentials.** { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
-dontwarn androidx.credentials.**
-dontwarn com.google.android.libraries.identity.googleid.**
