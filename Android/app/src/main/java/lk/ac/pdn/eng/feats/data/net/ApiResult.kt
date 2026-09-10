package lk.ac.pdn.eng.feats.data.net

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import retrofit2.HttpException
import java.io.IOException

/** One page of a paginated list endpoint — `hasMore` drives whether "load more" is offered. */
data class Page<T>(val items: List<T>, val hasMore: Boolean)

/** Lightweight result wrapper for repository calls. */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Error(val message: String, val code: Int? = null) : ApiResult<Nothing>

    val isSuccess: Boolean get() = this is Success
}

inline fun <T> ApiResult<T>.onSuccess(block: (T) -> Unit): ApiResult<T> {
    if (this is ApiResult.Success) block(data)
    return this
}

inline fun <T> ApiResult<T>.onError(block: (String, Int?) -> Unit): ApiResult<T> {
    if (this is ApiResult.Error) block(message, code)
    return this
}

// KotlinJsonAdapterFactory is not optional here: Moshi refuses to build a
// reflective adapter for a Kotlin class without it and throws instead. That
// throw happened inside the runCatching below, so EVERY server explanation was
// silently swallowed and every failure reached the user as the bare
// "Request failed (<code>)" fallback — overlap clashes, archived courses,
// out-of-window Collect taps, all of it. See ApiErrorMessageTest.
private val errorMoshi: Moshi by lazy { Moshi.Builder().add(KotlinJsonAdapterFactory()).build() }
private val errorAdapter by lazy { errorMoshi.adapter(ServerError::class.java) }

private class ServerError(val error: String? = null, val message: String? = null)

/**
 * Runs a Retrofit suspend call and normalises failures into [ApiResult.Error],
 * extracting the server's `{ "error": "..." }` body when present.
 */
suspend fun <T> apiCall(block: suspend () -> T): ApiResult<T> {
    return try {
        ApiResult.Success(block())
    } catch (e: HttpException) {
        val code = e.code()
        if (code == 401) SessionEvents.notifyUnauthorized()
        val parsed = runCatching {
            e.response()?.errorBody()?.string()?.let { errorAdapter.fromJson(it) }
        }.getOrNull()
        val msg = parsed?.error ?: parsed?.message ?: "Request failed ($code)"
        ApiResult.Error(msg, code)
    } catch (e: IOException) {
        ApiResult.Error(e.message ?: "Network error")
    } catch (e: Exception) {
        ApiResult.Error(e.message ?: "Unexpected error")
    }
}
