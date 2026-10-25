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
        versionCode = 13
        versionName = "0.10.0"
        buildConfigField("String", "START_URL", "\"https://www.hotgo.tv/\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // O overlay compartilhado (web/src/tv-overlay.js) entra como asset do APK
    sourceSets["main"].assets.srcDir("../../web/src")

    // Chave fixa vinda dos segredos do GitHub (HOTGO_KEYSTORE_B64 e HOTGO_KEYSTORE_PASSWORD): com ela,
    // cada versão instala por cima da anterior sem perder o login. Sem os segredos, usa a chave de debug,
    // que muda a cada build do CI.
    val keystorePath = System.getenv("HOTGO_KEYSTORE")
    if (keystorePath != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("HOTGO_KEYSTORE_PASSWORD")
                keyAlias = "hotgotv"
                keyPassword = System.getenv("HOTGO_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
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
