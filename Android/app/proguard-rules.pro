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
-keep class lk.ac.pdn.eng.attendance.data.net.** { *; }

# Kotlin metadata for reflection
-keep class kotlin.Metadata { *; }
