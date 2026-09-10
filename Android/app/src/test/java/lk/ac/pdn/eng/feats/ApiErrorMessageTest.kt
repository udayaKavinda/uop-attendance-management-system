package lk.ac.pdn.eng.feats

import kotlinx.coroutines.runBlocking
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.apiCall
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * The server explains every staff-facing rejection in `{ "error": "..." }`.
 * These tests pin that the explanation actually reaches the UI, instead of
 * being swallowed into the generic "Request failed (400)" fallback.
 */
class ApiErrorMessageTest {

    private fun httpError(code: Int, body: String): HttpException =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))

    private fun messageFor(code: Int, body: String): String {
        val result = runBlocking { apiCall<Any> { throw httpError(code, body) } }
        return (result as ApiResult.Error).message
    }

    @Test
    fun surfaces_the_servers_error_field() {
        assertEquals(
            "This session overlaps with an existing session for the same course",
            messageFor(400, """{"error":"This session overlaps with an existing session for the same course"}"""),
        )
    }

    @Test
    fun surfaces_the_servers_message_field_when_there_is_no_error_field() {
        assertEquals("Staff access required", messageFor(403, """{"message":"Staff access required"}"""))
    }

    @Test
    fun falls_back_to_the_status_only_when_the_body_explains_nothing() {
        assertEquals("Request failed (400)", messageFor(400, """{"unrelated":"x"}"""))
        assertEquals("Request failed (502)", messageFor(502, "<html>bad gateway</html>"))
    }
}
