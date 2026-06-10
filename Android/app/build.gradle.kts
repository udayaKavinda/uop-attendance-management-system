plugins {
    // AGP 9 has built-in Kotlin support, so no separate Kotlin Gradle plugin is
    // needed to compile Kotlin. The Compose Compiler plugin, however, is still
    // required whenever `buildFeatures { compose = true }` is set (Kotlin 2.0+).
    // It is applied without a version — AGP's built-in Kotlin provides it.
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "lk.ac.pdn.eng.attendance"
    compileSdk = 36

    defaultConfig {
        applicationId = "lk.ac.pdn.eng.attendance"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Production server base URL. Must match the server's APP_BASE_URL so the
        // native OAuth return is allowed. Can still be overridden on the login screen.
        buildConfigField("String", "DEFAULT_API_BASE", "\"https://attendance.eng.pdn.ac.lk\"")

        // Custom URI scheme the server redirects back to after Google OAuth.
        // Mirrors NATIVE_OAUTH_RETURN_BASES in server/src/utils/constants.js.
        manifestPlaceholders["oauthScheme"] = "lk.ac.pdn.eng.attendance"
        manifestPlaceholders["oauthHost"] = "oauth"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
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

    // OAuth Custom Tabs + secure storage
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
