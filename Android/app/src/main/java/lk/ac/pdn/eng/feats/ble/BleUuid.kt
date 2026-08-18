package lk.ac.pdn.eng.feats.ble

import java.util.UUID

/**
 * BLE token transport — the exact mirror of the web app's src/utils/bleToken.js.
 *
 * The rotating 16-hex-char session token is packed into a 128-bit service UUID
 * with a fixed "UOPA" namespace prefix so a scanner can recognise our beacons
 * and recover the token:
 *
 *   layout: 554f5041-TTTT-TTTT-TTTT-TTTT00000000   (T = token hex)
 */
object BleUuid {

    /** ASCII "UOPA" — identifies one of our attendance beacons. */
    const val PREFIX = "554f5041"

    private const val TOKEN_HEX_LEN = 16
    private val TOKEN_REGEX = Regex("^[0-9a-f]{16}$")

    /** Pack a 16-char hex token into a 128-bit service UUID. */
    fun tokenToUuid(token: String): UUID {
        val t = token.lowercase()
        require(TOKEN_REGEX.matches(t)) { "BLE token must be 16 hex characters" }
        val formatted = buildString {
            append(PREFIX)
            append('-')
            append(t.substring(0, 4))
            append('-')
            append(t.substring(4, 8))
            append('-')
            append(t.substring(8, 12))
            append('-')
            append(t.substring(12, 16))
            append("00000000")
        }
        return UUID.fromString(formatted)
    }

    /** Recover the token from a single UUID, or null if it is not one of ours. */
    fun uuidToToken(uuid: UUID): String? {
        val hex = uuid.toString().replace("-", "").lowercase()
        if (hex.length != 32 || !hex.startsWith(PREFIX)) return null
        val token = hex.substring(8, 8 + TOKEN_HEX_LEN)
        return if (TOKEN_REGEX.matches(token)) token else null
    }

    /** Find the first UOP attendance token across advertised service UUIDs. */
    fun extractToken(uuids: List<UUID>?): String? {
        if (uuids == null) return null
        for (uuid in uuids) {
            uuidToToken(uuid)?.let { return it }
        }
        return null
    }
}
