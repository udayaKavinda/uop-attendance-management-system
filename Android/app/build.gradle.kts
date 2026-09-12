import java.util.Properties

plugins {
    // AGP 9 has built-in Kotlin support, so no separate Kotlin Gradle plugin is
    // needed to compile Kotlin. The Compose Compiler plugin, however, is still
    // required whenever `buildFeatures { compose = true }` is set (Kotlin 2.0+).
    // It is applied without a version — AGP's built-in Kotlin provides it.
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Release signing credentials, kept out of git in keystore.properties (gitignored).
// Absent on machines/CI that don't need to produce a signed release build.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}
val releaseKeystorePath = keystoreProperties.getProperty("UOP_KEYSTORE_PATH")
val hasReleaseSigning = !releaseKeystorePath.isNullOrBlank() && file(releaseKeystorePath).exists()

/**
 * Google **Web** OAuth client id — Credential Manager passes it as `serverClientId`,
 * and the server verifies the returned ID token against the same value
 * (GOOGLE_CLIENT_ID in the server's .env). It is NOT a secret: it ships in every
 * copy of the app. Set it in `local.properties` (machine-local, gitignored) or in
 * `gradle.properties`:
 *
 *     GOOGLE_WEB_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
 *
 * Left blank the app still builds and simply falls back to browser sign-in.
 */
val localProperties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val googleWebClientId: String =
    localProperties.getProperty("GOOGLE_WEB_CLIENT_ID")
        ?: (project.findProperty("GOOGLE_WEB_CLIENT_ID") as String?)
        ?: ""

/**
 * Optional server override for **debug builds only** — release always points at
 * production, and nothing here can change that.
 *
 * Needed because verifying a GPS band on real hardware means driving a database
 * whose geofence and session are known, and the only such database is a local
 * one. Without this the app can only ever talk to production, so the choice was
 * to test bands against live data or not to test them on hardware at all.
 *
 * Set it in `local.properties` (machine-local, gitignored):
 *
 *     LOCAL_API_BASE=http://localhost:5000
 *
 * `localhost` works on a USB-attached phone via `adb reverse tcp:5000 tcp:5000`,
 * which is preferable to a LAN address because it survives changing networks.
 * Cleartext for it is permitted by `src/debug/res/xml/network_security_config.xml`
 * and only there — the main config still forbids it everywhere.
 *
 * Native Google sign-in keeps working against a local server: the client posts an
 * ID token and the server verifies it against GOOGLE_CLIENT_ID, with no redirect
 * URI involved, so the same web client id is valid on any host.
 */
val localApiBase: String =
    localProperties.getProperty("LOCAL_API_BASE")
        ?: (project.findProperty("LOCAL_API_BASE") as String?)
        ?: ""

android {
    namespace = "lk.ac.pdn.eng.feats"
    compileSdk = 36

    defaultConfig {
        applicationId = "lk.ac.pdn.eng.feats"
        minSdk = 24
        // Must not exceed compileSdk: targeting an API level the app was not
        // compiled against means the behaviour changes for that level are opted
        // into without the SDK that defines them being present, and Play rejects
        // an upload whose targetSdk is above the latest stable platform. This was
        // 37 against compileSdk 36.
        targetSdk = 36
        versionCode = 10
        versionName = "2.0.0"

        // Fixed production server. Must match the server's APP_BASE_URL so the
        // native OAuth return is allowed.
        buildConfigField("String", "DEFAULT_API_BASE", "\"https://attendance.eng.pdn.ac.lk\"")

        // Web OAuth client id used by Credential Manager (see googleWebClientId above).
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")

        // Custom URI scheme the server redirects back to after Google OAuth.
        // Mirrors NATIVE_OAUTH_RETURN_BASES in server/src/utils/constants.js.
        manifestPlaceholders["oauthScheme"] = "lk.ac.pdn.eng.attendance"
        manifestPlaceholders["oauthHost"] = "oauth"

        // On-device (instrumentation) tests. See app/src/androidTest — the
        // mock-location guard can only be exercised against a real platform
        // LocationManager, so it lives there rather than in the JVM suite.
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = keystoreProperties.getProperty("UOP_KEYSTORE_PASSWORD")
                keyAlias = keystoreProperties.getProperty("UOP_KEY_ALIAS")
                keyPassword = keystoreProperties.getProperty("UOP_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            ndk {
                debugSymbolLevel = "FULL"
            }
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }

        /**
         * Debug is signed with the **release/upload** key, not the per-machine
         * `~/.android/debug.keystore`.
         *
         * Credential Manager authorises native Google sign-in by package name
         * *plus signing-certificate SHA-1*, matched against an Android OAuth
         * client in the Cloud project. A debug keystore is generated afresh on
         * every developer machine, so after a machine change its SHA-1 is no
         * longer the registered one, `GetGoogleIdOption` returns no credential,
         * and the app reports the misleading "No Google account is available on
         * this device" — with the browser fallback still working, because web
         * OAuth checks a redirect URI rather than a signature.
         *
         * Signing debug with the upload key gives one stable fingerprint that
         * survives machine changes. Registered SHA-1s for lk.ac.pdn.eng.feats:
         *   76:0E:… upload key   — these local builds
         *   C6:4E:… Play signing — Play-delivered installs (Google re-signs)
         *
         * Falls back to the default debug keystore when keystore.properties is
         * absent, so a fresh clone still builds (native sign-in just won't work).
         */
        debug {
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            // Debug-only server override; see localApiBase above. Absent from
            // local.properties, a debug build is identical to before and points
            // at production.
            if (localApiBase.isNotBlank()) {
                buildConfigField("String", "DEFAULT_API_BASE", "\"$localApiBase\"")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // AndroidX core
    implementation(libs.androidx.core.ktx)
    implementation(libs.material)

    // Lifecycle / Activity / Compose
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)

    // Networking
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.moshi)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.moshi)
    implementation(libs.moshi.kotlin)

    // Native OpenStreetMap geofence editor (no WebView or API key).
    implementation(libs.osmdroid)

    // Native Google sign-in (Credential Manager)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)

    // OAuth Custom Tabs (browser fallback) + secure storage
    implementation(libs.androidx.browser)
    implementation(libs.androidx.security.crypto)

    // Debug tooling
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Testing
    testImplementation(libs.junit)

    // On-device tests
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
