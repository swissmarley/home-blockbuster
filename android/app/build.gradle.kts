plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Release signing. CI passes a private key through the HB_KEYSTORE_* environment variables when the
// repository has those secrets; otherwise the public community key in android/keystore is used, so
// every build of the open-source APK can be installed over the previous one.
val keystorePath = System.getenv("HB_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }
val communityKeystore = rootProject.file("keystore/community.jks")

android {
    namespace = "com.swissmarley.homeblockbuster"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.swissmarley.homeblockbuster"
        minSdk = 26
        // Google Play requires new apps and updates to target the latest API level (Android 16).
        targetSdk = 36
        versionCode = (System.getenv("HB_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("HB_VERSION_NAME") ?: "1.0.0"
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("HB_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("HB_KEY_ALIAS")
                keyPassword = System.getenv("HB_KEY_PASSWORD")
            } else {
                storeFile = communityKeystore
                storePassword = "homeblockbuster"
                keyAlias = "homeblockbuster"
                keyPassword = "homeblockbuster"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
        // Robolectric needs the merged resources for the Play Store screenshot test (test-only).
        unitTests.isIncludeAndroidResources = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.07.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")

    val media3 = "1.8.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("androidx.media3:media3-ui:$media3")

    testImplementation("junit:junit:4.13.2")

    // Play Store screenshots (android/play-store/make-screenshots.sh): the real app rendered by Robolectric against an
    // in-process demo server, captured with Roborazzi. Test-only, so the release build is unchanged.
    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.46.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

// The screenshot test is slow and needs the generated demo artwork, so it only runs when asked for.
tasks.withType<Test>().configureEach {
    val art = System.getenv("HB_SCREENSHOT_ART")
    if (art == null) {
        exclude("**/screenshots/**")
    } else {
        maxHeapSize = "3g"
        systemProperty("roborazzi.test.record", "true")
        // Robolectric downloads its Android runtime from Maven Central; allow a mirror when that is rate-limited.
        System.getenv("ROBOLECTRIC_REPO_URL")?.let { systemProperty("robolectric.dependency.repo.url", it) }
        outputs.upToDateWhen { false }
    }
}

// A Play Store bundle must be signed with the private upload key, never the public community key:
// anyone could sign an "update" with that one. scripts/build-play-bundle.sh sets HB_KEYSTORE_*.
gradle.taskGraph.whenReady {
    if (keystorePath == null && allTasks.any { it.path == ":app:bundleRelease" }) {
        throw GradleException(
            "bundleRelease needs the private upload key (HB_KEYSTORE_FILE). Run android/scripts/build-play-bundle.sh."
        )
    }
}
