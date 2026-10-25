package dev.cruz.hotgotv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast

/**
 * Casca do HotGo para Fire TV: abre o site oficial numa WebView em tela cheia e
 * injeta o overlay de TV (assets/tv-overlay.js). O login é o do site; o overlay monta o
 * catálogo pela API e toca os vídeos (HLS) num <video> próprio.
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var lastBackPress = 0L

    // Página atual, para a ponte nativa só atender o hotgo.tv (a ponte roda fora da thread da UI)
    @Volatile
    private var currentUrl: String? = null

    private var splash: View? = null
    private val handler = Handler(Looper.getMainLooper())

    private val overlayJs: String by lazy {
        assets.open("tv-overlay.js").bufferedReader().use { it.readText() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Permite inspecionar a página pelo chrome://inspect com adb conectado
        WebView.setWebContentsDebuggingEnabled(true)

        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
        }
        root.addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
        // Tela de abertura própria: o site carrega por baixo e some quando o overlay avisa que está pronto
        splash = buildSplash()
        root.addView(splash, FrameLayout.LayoutParams(MATCH, MATCH))
        handler.postDelayed(::hideSplash, SPLASH_MAX_MS)
        setContentView(root)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = desktopUserAgent(userAgentString)
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }

        web.addJavascriptInterface(NativeBridge(), "HotGoNative")

        web.webViewClient = object : WebViewClient() {
            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                currentUrl = url
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme ?: return true
                // Links fora de http(s) (intent:, whatsapp: etc.) não têm para onde ir na TV
                return scheme != "http" && scheme != "https"
            }

            // O overlay entra assim que a página aparece, sem esperar os ~15 s de scripts do site;
            // ele mesmo ignora a segunda injeção (onPageFinished fica de reserva)
            override fun onPageCommitVisible(view: WebView, url: String) {
                view.evaluateJavascript(overlayJs, null)
            }

            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(overlayJs, null)
                CookieManager.getInstance().flush()
            }

            // Rastreadores, anúncios e as capas gigantes do site (que fica escondido) só pesam na TV
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (!isBlocked(request.url)) return null
                return WebResourceResponse("text/plain", "utf-8", 204, "No Content",
                    mapOf("Access-Control-Allow-Origin" to "*"), "".byteInputStream())
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // console do overlay no logcat (adb logcat -s hotgoTV) para investigar na TV
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i("hotgoTV", "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                // Widevine (DRM) na WebView precisa desta permissão
                val drm = request.resources.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }
                if (drm.isNotEmpty()) request.grant(drm.toTypedArray()) else request.deny()
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                fullscreenView = view
                fullscreenCallback = callback
                root.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
                web.visibility = View.GONE
            }

            override fun onHideCustomView() {
                exitFullscreen()
            }
        }

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl(intent?.data?.takeIf { it.host?.let(::isHotgoHost) == true }?.toString()
                ?: BuildConfig.START_URL)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) {
            return if (event.keyCode in HANDLED_KEYS) true else super.dispatchKeyEvent(event)
        }
        when (event.keyCode) {
            KeyEvent.KEYCODE_BACK -> onBack()
            KeyEvent.KEYCODE_MENU -> js("window.hotgoTV && window.hotgoTV.toggleHome()")
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE -> js("window.hotgoTV && window.hotgoTV.playPause()")
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> js("window.hotgoTV && window.hotgoTV.seek(30)")
            KeyEvent.KEYCODE_MEDIA_REWIND -> js("window.hotgoTV && window.hotgoTV.seek(-30)")
            else -> return super.dispatchKeyEvent(event)
        }
        return true
    }

    private fun onBack() {
        if (fullscreenView != null) {
            exitFullscreen()
            return
        }
        web.evaluateJavascript("window.hotgoTV ? window.hotgoTV.back() : false") { handled ->
            if (handled == "true") return@evaluateJavascript
            when {
                web.canGoBack() -> web.goBack()
                System.currentTimeMillis() - lastBackPress < 2000 -> finish()
                else -> {
                    lastBackPress = System.currentTimeMillis()
                    Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun exitFullscreen() {
        val view = fullscreenView ?: return
        root.removeView(view)
        fullscreenView = null
        web.visibility = View.VISIBLE
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
        web.requestFocus()
    }

    private fun js(code: String) = web.evaluateJavascript(code, null)

    /** Chamado pelo overlay (window.HotGoNative) para tocar o HLS no player nativo. */
    inner class NativeBridge {
        @JavascriptInterface
        fun play(url: String, title: String?): Boolean = playFrom(url, title, "0")

        /** Igual a play, começando em startMs (o "Continuar assistindo" do overlay). */
        @JavascriptInterface
        fun playFrom(url: String, title: String?, startMs: String?): Boolean {
            val page = currentUrl?.let(Uri::parse)?.host ?: return false
            val video = Uri.parse(url)
            if (!isHotgoHost(page) || video.scheme != "https") return false
            val start = startMs?.toLongOrNull() ?: 0L
            runOnUiThread { PlayerActivity.start(this@MainActivity, url, title.orEmpty(), start) }
            return true
        }

        /** O overlay montou o Início (ou o login): tira a tela de abertura. */
        @JavascriptInterface
        fun ready() {
            runOnUiThread { hideSplash() }
        }

        // Voltar duas vezes no Início do overlay fecha o app em vez de voltar pelo histórico do site
        @JavascriptInterface
        fun exit() {
            runOnUiThread { finish() }
        }
    }

    private fun buildSplash(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.rgb(15, 15, 15))
        addView(TextView(context).apply {
            text = "HOTGO"
            setTextColor(Color.rgb(229, 9, 20))
            textSize = 56f
            paint.isFakeBoldText = true
            letterSpacing = 0.08f
        })
        addView(ProgressBar(context).apply { isIndeterminate = true },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = 48 })
    }

    private fun hideSplash() {
        val view = splash ?: return
        splash = null
        view.animate().alpha(0f).setDuration(200).withEndAction { root.removeView(view) }.start()
        web.requestFocus()
    }

    private fun isBlocked(url: Uri): Boolean {
        val host = url.host ?: return false
        if (BLOCKED_HOSTS.any { host == it || host.endsWith(".$it") }) return true
        if (host == "www.gstatic.com" && url.path.orEmpty().startsWith("/cv/js/sender")) return true
        if (host == "www.facebook.com" && url.path == "/tr") return true
        // o overlay pede as capas já reduzidas (?width=); sem isso é o site carregando 1920 px por capa
        return host == "img.streann.tech" && url.getQueryParameter("width") == null
    }

    private fun isHotgoHost(host: String) = host == "hotgo.tv" || host.endsWith(".hotgo.tv")

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        PlayerActivity.lastResult?.let { (pos, dur) ->
            PlayerActivity.lastResult = null
            js("window.hotgoTV && window.hotgoTV.playerClosed($pos, $dur)")
        }
    }

    override fun onPause() {
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        root.removeAllViews()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val SPLASH_MAX_MS = 25_000L

        private val BLOCKED_HOSTS = listOf(
            "doubleclick.net", "googletagmanager.com", "google-analytics.com", "connect.facebook.net",
            "contentsquare.net", "hotjar.com", "sdk-web.y.uno", "kochava.com", "cookingmetrics.com",
            "inside-ads.services.c1.streann.com", "ads.streann.tech"
        )

        private val HANDLED_KEYS = setOf(
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_MENU,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_REWIND
        )

        /**
         * A WebView se identifica como celular ("; wv", "Mobile") e o site pode servir a
         * versão mobile. Usamos um user agent de Chrome desktop com a versão real do motor.
         */
        fun desktopUserAgent(default: String): String {
            val chrome = Regex("Chrome/[\\d.]+").find(default)?.value ?: "Chrome/120.0.0.0"
            return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) $chrome Safari/537.36"
        }
    }
}
