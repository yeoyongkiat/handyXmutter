package com.handyxmutter.journal

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

class MainActivity : TauriActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return

        val type = intent.type ?: return

        when {
            type == "text/plain" -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
                val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
                writeShareData("text", text, subject, null)
            }
            type.startsWith("audio/") || type.startsWith("video/") -> {
                val uri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                if (uri == null) return

                val localPath = copyUriToLocal(uri, type)
                if (localPath != null) {
                    val shareType = if (type.startsWith("audio")) "audio" else "video"
                    writeShareData(shareType, null, null, localPath)
                }
            }
        }
    }

    /**
     * Write share data to a JSON file that the Rust backend can read.
     * File is placed in the app's files directory at `pending_share.json`.
     */
    private fun writeShareData(shareType: String, text: String?, subject: String?, filePath: String?) {
        try {
            val json = JSONObject().apply {
                put("type", shareType)
                if (text != null) put("text", text)
                if (subject != null) put("subject", subject)
                if (filePath != null) put("file_path", filePath)
            }
            val file = File(filesDir, "pending_share.json")
            file.writeText(json.toString())
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Failed to write share data: ${e.message}")
        }
    }

    private fun copyUriToLocal(uri: Uri, mimeType: String): String? {
        return try {
            val inputStream = contentResolver.openInputStream(uri) ?: return null
            val extension = when {
                mimeType.contains("wav") -> ".wav"
                mimeType.contains("mp3") || mimeType.contains("mpeg") -> ".mp3"
                mimeType.contains("mp4") || mimeType.contains("m4a") -> ".m4a"
                mimeType.contains("ogg") -> ".ogg"
                mimeType.contains("webm") -> ".webm"
                mimeType.contains("video") -> ".mp4"
                else -> ".bin"
            }
            val cacheDir = File(cacheDir, "shared")
            cacheDir.mkdirs()
            val outFile = File(cacheDir, "share-${System.currentTimeMillis()}$extension")
            FileOutputStream(outFile).use { output ->
                inputStream.copyTo(output)
            }
            inputStream.close()
            outFile.absolutePath
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Failed to copy shared file: ${e.message}")
            null
        }
    }
}
