plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.shivapal.opencodepocket"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.shivapal.opencodepocket"
        // Android 8.0 — the oldest version with reliable WebView + foreground
        // service behaviour for this app.
        minSdk = 26
        // Kept at 36: the general (Termux) path is verified at this level and
        // the bundled proot runs from the native library directory, which is
        // executable regardless of targetSdk.
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        externalNativeBuild {
            cmake {
                abiFilters += "arm64-v8a"
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    // No AndroidX WebKit dependency: the bundled HTTP server serves the web
    // client and proxies the API, so WebView only ever sees one origin.
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
}

/**
 * The web client is the single source of truth. Copy it into the Android
 * assets at build time so the APK always contains the same files the PWA
 * serves — there is no second copy to keep in sync.
 */
// The Android project lives in <repo>/android, so the web client is one level up.
val webRoot = rootProject.projectDir.parentFile

tasks.register<Copy>("copyWebAssets") {
    // index.html loads ./assets/app.js, so the JS/CSS go one directory in.
    from(File(webRoot, "assets")) { into("assets") }
    from(File(webRoot, "index.html"))
    from(File(webRoot, "manifest.webmanifest"))
    from(File(webRoot, "sw.js"))
    into(layout.projectDirectory.dir("src/main/assets"))
}

tasks.named("preBuild") {
    dependsOn("copyWebAssets")
}
