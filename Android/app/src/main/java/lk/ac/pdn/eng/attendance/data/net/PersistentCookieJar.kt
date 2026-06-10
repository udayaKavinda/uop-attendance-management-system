package lk.ac.pdn.eng.attendance.data.net

import lk.ac.pdn.eng.attendance.data.prefs.SessionPrefs
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.util.concurrent.ConcurrentHashMap

/**
 * Cookie jar that persists cookies (notably the Express `attendance.sid` session
 * cookie) to encrypted storage so the signed-in session survives app restarts.
 *
 * The native OAuth flow works because the server sets the session cookie on the
 * `POST /api/auth/exchange-code` HTTP response — which this OkHttp client makes —
 * so the cookie lands in this jar (the Custom Tab's browser cookies are separate
 * and irrelevant).
 */
class PersistentCookieJar(private val prefs: SessionPrefs) : CookieJar {

    // host -> (cookie name -> cookie)
    private val store = ConcurrentHashMap<String, MutableMap<String, Cookie>>()

    init {
        load()
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val host = url.host
        val map = store.getOrPut(host) { ConcurrentHashMap() }
        val now = System.currentTimeMillis()
        for (cookie in cookies) {
            if (cookie.expiresAt <= now) {
                map.remove(cookie.name)
            } else {
                map[cookie.name] = cookie
            }
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val map = store[url.host] ?: return emptyList()
        val now = System.currentTimeMillis()
        val valid = ArrayList<Cookie>()
        val expired = ArrayList<String>()
        for ((name, cookie) in map) {
            if (cookie.expiresAt <= now) {
                expired.add(name)
            } else if (cookie.matches(url)) {
                valid.add(cookie)
            }
        }
        if (expired.isNotEmpty()) {
            expired.forEach { map.remove(it) }
            persist()
        }
        return valid
    }

    /** Drops every stored cookie (used on logout). */
    @Synchronized
    fun clear() {
        store.clear()
        prefs.writeCookies(null)
    }

    private fun persist() {
        val sb = StringBuilder()
        for ((host, map) in store) {
            for (cookie in map.values) {
                sb.append(serialize(host, cookie)).append('\n')
            }
        }
        prefs.writeCookies(sb.toString())
    }

    private fun load() {
        val raw = prefs.readCookies() ?: return
        raw.lineSequence().filter { it.isNotBlank() }.forEach { line ->
            val (host, cookie) = deserialize(line) ?: return@forEach
            store.getOrPut(host) { ConcurrentHashMap() }[cookie.name] = cookie
        }
    }

    // Pipe-delimited: host|name|value|domain|path|expiresAt|secure|httpOnly|hostOnly
    private fun serialize(host: String, c: Cookie): String = listOf(
        host, c.name, c.value, c.domain, c.path, c.expiresAt.toString(),
        c.secure.toString(), c.httpOnly.toString(), c.hostOnly.toString(),
    ).joinToString("|") { it.replace("|", "%7C") }

    private fun deserialize(line: String): Pair<String, Cookie>? {
        val parts = line.split("|").map { it.replace("%7C", "|") }
        if (parts.size < 9) return null
        return try {
            val host = parts[0]
            val builder = Cookie.Builder()
                .name(parts[1])
                .value(parts[2])
                .path(parts[4])
                .expiresAt(parts[5].toLong())
            if (parts[8].toBoolean()) builder.hostOnlyDomain(parts[3]) else builder.domain(parts[3])
            if (parts[6].toBoolean()) builder.secure()
            if (parts[7].toBoolean()) builder.httpOnly()
            host to builder.build()
        } catch (e: Exception) {
            null
        }
    }
}
