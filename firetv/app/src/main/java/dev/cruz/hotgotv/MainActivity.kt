package dev.cruz.hotgotv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
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

            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(overlayJs, null)
                CookieManager.getInstance().flush()
            }
        }

        web.webChromeClient = object : WebChromeClient() {
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
        fun play(url: String, title: String?): Boolean {
            val page = currentUrl?.let(Uri::parse)?.host ?: return false
            val video = Uri.parse(url)
            if (!isHotgoHost(page) || video.scheme != "https") return false
            runOnUiThread { PlayerActivity.start(this@MainActivity, url, title.orEmpty()) }
            return true
        }

        // Voltar duas vezes no Início do overlay fecha o app em vez de voltar pelo histórico do site
        @JavascriptInterface
        fun exit() {
            runOnUiThread { finish() }
        }
    }

    private fun isHotgoHost(host: String) = host == "hotgo.tv" || host.endsWith(".hotgo.tv")

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        root.removeAllViews()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT

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
