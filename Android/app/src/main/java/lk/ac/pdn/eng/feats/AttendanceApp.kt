package lk.ac.pdn.eng.feats

import android.app.Application
import lk.ac.pdn.eng.feats.data.net.NetworkModule
import lk.ac.pdn.eng.feats.data.net.PersistentCookieJar
import lk.ac.pdn.eng.feats.data.prefs.SessionPrefs
import lk.ac.pdn.eng.feats.data.repo.AppRepository

/**
 * Application entry point. Hosts a tiny manual service locator so we avoid a DI
 * framework while still sharing single instances of the network stack, prefs,
 * cookie jar and repository across the app.
 */
class AttendanceApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

class AppContainer(app: AttendanceApp) {
    val prefs: SessionPrefs = SessionPrefs(app)
    val cookieJar: PersistentCookieJar = PersistentCookieJar(prefs)
    private val network: NetworkModule = NetworkModule(cookieJar)
    val repository: AppRepository = AppRepository(network.api)
}
