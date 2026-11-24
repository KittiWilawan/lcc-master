package com.looklancare.app.monitoring

import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.net.URI

/** The evidence file is optional. An unreadable attachment must not block the fall event. */
internal fun readDeliveryImage(uri: String?, maxBytes: Int): ByteArray? {
  if (uri == null) return null
  return try {
    val file = File(URI(uri))
    val size = file.length()
    if (!file.isFile || size !in 2L..maxBytes.toLong()) return null
    DataInputStream(file.inputStream()).use { stream ->
      val bytes = ByteArray(size.toInt())
      stream.readFully(bytes)
      bytes.takeIf { it[0] == 0xff.toByte() && it[1] == 0xd8.toByte() && stream.read() == -1 }
    }
  } catch (_: IOException) { null }
    catch (_: IllegalArgumentException) { null }
    catch (_: java.net.URISyntaxException) { null }
    catch (_: SecurityException) { null }
}
