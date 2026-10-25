package dev.cruz.hotgotv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.Toast
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/**
 * Player nativo (ExoPlayer) para os vídeos do HotGo: HLS sem DRM, com a barra de
 * controle do Media3, que já sabe lidar com o direcional do controle remoto.
 * O overlay chama HotGoNative.play(url, título) e esta tela abre por cima da WebView.
 */
class PlayerActivity : Activity() {

    private lateinit var view: PlayerView
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        view = PlayerView(this).apply {
            keepScreenOn = true
            controllerShowTimeoutMs = CONTROLLER_TIMEOUT_MS
            setShowFastForwardButton(true)
            setShowRewindButton(true)
            setShowNextButton(false)
            setShowPreviousButton(false)
        }
        setContentView(view)
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

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val exo = player ?: return super.dispatchKeyEvent(event)
        // Com a barra escondida, as setas e o OK já agem no vídeo sem precisar abrir a barra antes
        if (event.action == KeyEvent.ACTION_DOWN && !view.isControllerFullyVisible) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> { exo.seekBack(); view.showController(); return true }
                KeyEvent.KEYCODE_DPAD_RIGHT -> { exo.seekForward(); view.showController(); return true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                    exo.playWhenReady = !exo.playWhenReady
                    view.showController()
                    return true
                }
            }
        }
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { exo.seekTo(exo.currentPosition + FAST_MS); view.showController(); return true }
                KeyEvent.KEYCODE_MEDIA_REWIND -> { exo.seekTo((exo.currentPosition - FAST_MS).coerceAtLeast(0)); view.showController(); return true }
            }
        }
        return view.dispatchKeyEvent(event) || super.dispatchKeyEvent(event)
    }

    companion object {
        private const val EXTRA_URL = "url"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_POSITION = "position"
        private const val SEEK_MS = 10_000L
        private const val FAST_MS = 30_000L
        private const val CONTROLLER_TIMEOUT_MS = 3_000

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
