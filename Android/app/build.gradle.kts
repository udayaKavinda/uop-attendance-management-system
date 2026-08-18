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
val hasReleaseSigning = keystoreProperties.getProperty("UOP_KEYSTORE_PATH") != null

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

android {
    namespace = "lk.ac.pdn.eng.feats"
    compileSdk = 36

    defaultConfig {
        applicationId = "lk.ac.pdn.eng.feats"
        minSdk = 24
        targetSdk = 37
        versionCode = 4
        versionName = "1.3.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Fixed production server. Must match the server's APP_BASE_URL so the
        // native OAuth return is allowed.
        buildConfigField("String", "DEFAULT_API_BASE", "\"https://attendance.eng.pdn.ac.lk\"")

        // Web OAuth client id used by Credential Manager (see googleWebClientId above).
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")

        // Custom URI scheme the server redirects back to after Google OAuth.
        // Mirrors NATIVE_OAUTH_RETURN_BASES in server/src/utils/constants.js.
        manifestPlaceholders["oauthScheme"] = "lk.ac.pdn.eng.attendance"
        manifestPlaceholders["oauthHost"] = "oauth"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("UOP_KEYSTORE_PATH"))
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
    implementation(libs.androidx.appcompat)
    implementation(libs.material)

    // Lifecycle / Activity / Compose
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
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
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
}
