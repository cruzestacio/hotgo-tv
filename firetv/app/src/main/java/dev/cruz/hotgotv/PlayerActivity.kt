package dev.cruz.hotgotv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.DefaultTimeBar
import androidx.media3.ui.PlayerView

/**
 * Player nativo (ExoPlayer) para os vídeos do HotGo: HLS sem DRM, com a barra de
 * controle do Media3, que já sabe lidar com o direcional do controle remoto.
 * O overlay chama HotGoNative.play(url, título) e esta tela abre por cima da WebView.
 */
class PlayerActivity : Activity() {

    private lateinit var view: PlayerView
    private lateinit var titleView: TextView
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        view = PlayerView(this).apply {
            keepScreenOn = true
            controllerShowTimeoutMs = CONTROLLER_TIMEOUT_MS
            // as setas já voltam/avançam; na barra fica só o play/pausa no centro, como no YouTube
            setShowFastForwardButton(false)
            setShowRewindButton(false)
            setShowNextButton(false)
            setShowPreviousButton(false)
        }
        // como no YouTube: barra de progresso vermelha com bolinha branca
        view.findViewById<DefaultTimeBar>(androidx.media3.ui.R.id.exo_progress)?.apply {
            setPlayedColor(Color.rgb(255, 0, 0))
            setScrubberColor(Color.WHITE)
            setBufferedColor(Color.argb(140, 255, 255, 255))
            setUnplayedColor(Color.argb(70, 255, 255, 255))
        }
        // título no canto superior esquerdo, aparecendo junto com os controles
        titleView = TextView(this).apply {
            text = intent.getStringExtra(EXTRA_TITLE).orEmpty()
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, resources.displayMetrics.heightPixels * 0.037f)
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 2
            val padH = (resources.displayMetrics.widthPixels * 0.05f).toInt()
            val padV = (resources.displayMetrics.heightPixels * 0.06f).toInt()
            setPadding(padH, padV, padH, padV * 2)
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.argb(200, 0, 0, 0), Color.TRANSPARENT)
            )
        }
        view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
            titleView.visibility = visibility
        })
        val root = FrameLayout(this)
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(titleView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        titleView.visibility = View.GONE
        setContentView(root)
    }

    override fun onStart() {
        super.onStart()
        val url = intent.getStringExtra(EXTRA_URL) ?: return finish()
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        val exo = ExoPlayer.Builder(this)
            .setSeekBackIncrementMs(SEEK_MS)
            .setSeekForwardIncrementMs(SEEK_MS)
            .build()
        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    lastResult = longArrayOf(exo.duration, exo.duration)
                    finish()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                Toast.makeText(this@PlayerActivity, getString(R.string.player_error, error.errorCodeName), Toast.LENGTH_LONG).show()
                finish()
            }
        })
        val item = MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
            .build()
        exo.setMediaItem(item)
        exo.seekTo(intent.getLongExtra(EXTRA_POSITION, 0L))
        exo.playWhenReady = true
        exo.prepare()
        view.player = exo
        player = exo
    }

    override fun onStop() {
        player?.let {
            intent.putExtra(EXTRA_POSITION, it.currentPosition)
            // a WebView lê isso ao voltar, para o "Continuar assistindo"
            lastResult = longArrayOf(it.currentPosition, it.duration.coerceAtLeast(0))
            it.release()
        }
        player = null
        view.player = null
        super.onStop()
    }

    /**
     * Controle como no YouTube/Netflix: as setas e o OK sempre agem no vídeo, sem passear pelos
     * botões da barra. Esquerda/direita voltam/avançam (segurar acelera: 10 s, 30 s, 60 s),
     * OK pausa/continua, cima/baixo só mostram os controles.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val exo = player ?: return super.dispatchKeyEvent(event)
        val code = event.keyCode
        if (code !in VIDEO_KEYS) return super.dispatchKeyEvent(event)
        if (event.action != KeyEvent.ACTION_DOWN) return true
        when (code) {
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> seekBy(exo, -stepFor(event, code))
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> seekBy(exo, stepFor(event, code))
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> if (event.repeatCount == 0) exo.playWhenReady = !exo.playWhenReady
            KeyEvent.KEYCODE_MEDIA_PLAY -> exo.playWhenReady = true
            KeyEvent.KEYCODE_MEDIA_PAUSE -> exo.playWhenReady = false
        }
        view.showController()
        return true
    }

    private fun stepFor(event: KeyEvent, code: Int): Long {
        if (code == KeyEvent.KEYCODE_MEDIA_REWIND || code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) return FAST_MS
        return when {
            event.repeatCount < 3 -> SEEK_MS
            event.repeatCount < 12 -> FAST_MS
            else -> FASTER_MS
        }
    }

    private fun seekBy(exo: ExoPlayer, delta: Long) {
        val duration = exo.duration
        var target = (exo.currentPosition + delta).coerceAtLeast(0L)
        if (duration > 0) target = target.coerceAtMost((duration - 1_000L).coerceAtLeast(0L))
        exo.seekTo(target)
    }

    companion object {
        private const val EXTRA_URL = "url"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_POSITION = "position"
        private const val SEEK_MS = 10_000L
        private const val FAST_MS = 30_000L
        private const val FASTER_MS = 60_000L
        private val VIDEO_KEYS = setOf(
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_REWIND
        )
        private const val CONTROLLER_TIMEOUT_MS = 5_000

        /** Posição e duração (ms) de quando o player fechou; MainActivity consome no onResume. */
        @Volatile
        var lastResult: LongArray? = null

        fun start(context: Context, url: String, title: String, startMs: Long = 0L) {
            lastResult = null
            context.startActivity(
                Intent(context, PlayerActivity::class.java)
                    .putExtra(EXTRA_URL, url)
                    .putExtra(EXTRA_TITLE, title)
                    .putExtra(EXTRA_POSITION, startMs.coerceAtLeast(0L))
            )
        }
    }
}
