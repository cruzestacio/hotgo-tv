plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.cruz.hotgotv"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.cruz.hotgotv"
        // Fire OS 5 (Fire TV Stick 2ª geração) é API 22; Fire OS 7/8 vêm acima disso
        minSdk = 22
        targetSdk = 34
        versionCode = 6
        versionName = "0.5.0"
        buildConfigField("String", "START_URL", "\"https://www.hotgo.tv/\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // O overlay compartilhado (web/src/tv-overlay.js) entra como asset do APK
    sourceSets["main"].assets.srcDir("../../web/src")

    buildTypes {
        release {
            isMinifyEnabled = false
            // App de uso pessoal instalado por sideload: assina com a chave de debug
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Player nativo para o HLS do HotGo (PlayerActivity)
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
}
