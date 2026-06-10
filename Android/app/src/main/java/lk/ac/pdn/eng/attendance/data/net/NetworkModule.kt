package lk.ac.pdn.eng.attendance.data.net

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import lk.ac.pdn.eng.attendance.BuildConfig
import lk.ac.pdn.eng.attendance.data.prefs.SessionPrefs
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Single OkHttp/Retrofit stack with a persistent cookie jar.
 *
 * The Retrofit base URL is a fixed placeholder; [BaseUrlInterceptor] rewrites the
 * scheme/host/port of every request to whatever the user configured at runtime,
 * so the server address can change without rebuilding Retrofit.
 */
class NetworkModule(private val prefs: SessionPrefs, val cookieJar: PersistentCookieJar) {

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .addInterceptor(BaseUrlInterceptor(prefs))
        .addInterceptor(HeaderInterceptor())
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(
                    HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC },
                )
            }
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    val api: ApiService = Retrofit.Builder()
        .baseUrl("http://placeholder.invalid/")
        .client(client)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()
        .create(ApiService::class.java)
}

/** Rewrites each request's origin to the configured server base URL. */
private class BaseUrlInterceptor(private val prefs: SessionPrefs) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val configured = prefs.baseUrl.toHttpUrlOrNull()
            ?: return chain.proceed(chain.request())
        val request = chain.request()
        val newUrl = request.url.newBuilder()
            .scheme(configured.scheme)
            .host(configured.host)
            .port(configured.port)
            .build()
        return chain.proceed(request.newBuilder().url(newUrl).build())
    }
}

/**
 * Adds the X-Requested-With header the server's CSRF guard requires on all
 * mutating API routes (see the server's csrf middleware).
 */
private class HeaderInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val request = chain.request().newBuilder()
            .header("X-Requested-With", "attendance-android")
            .header("Accept", "application/json")
            .build()
        return chain.proceed(request)
    }
}
