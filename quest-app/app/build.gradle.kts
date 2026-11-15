plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.jetbrains.kotlin.android)
  alias(libs.plugins.compose.compiler)
}

android {
  namespace = "com.claudexr.quest"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.claudexr.quest"
    // HorizonOS is Android 14 (API level 34)
    minSdk = 34
    targetSdk = 34
    versionCode = 6
    versionName = "0.4.1"
  }

  packaging { resources.excludes.add("META-INF/LICENSE") }

  lint {
    abortOnError = false
    checkReleaseBuilds = false
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      // Sideload-only MVP: sign release with the debug key so `assembleRelease` is installable too.
      signingConfig = signingConfigs.getByName("debug")
    }
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity.compose)
  implementation(platform(libs.androidx.compose.bom))
  implementation(libs.androidx.ui)
  implementation(libs.androidx.ui.graphics)
  implementation(libs.androidx.material3)

  implementation(libs.meta.spatial.sdk.base)
  implementation(libs.meta.spatial.sdk.toolkit)
  implementation(libs.meta.spatial.sdk.vr)
  implementation(libs.meta.spatial.sdk.compose)
  implementation(libs.meta.spatial.sdk.mruk)

  implementation(libs.okhttp)
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.zxing.core) // QR detection for screen calibration (pure Java, ~0.5 MB)

  testImplementation(libs.junit)
  testImplementation(libs.org.json) // real org.json for JVM unit tests (android.jar only has stubs)
}
