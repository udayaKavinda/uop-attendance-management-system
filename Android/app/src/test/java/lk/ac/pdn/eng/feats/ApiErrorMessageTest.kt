package lk.ac.pdn.eng.feats

import kotlinx.coroutines.runBlocking
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.NETWORK_MESSAGE
import lk.ac.pdn.eng.feats.data.net.UNEXPECTED_MESSAGE
import lk.ac.pdn.eng.feats.data.net.apiCall
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

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

    private fun messageForThrown(e: Throwable): String {
        val result = runBlocking { apiCall<Any> { throw e } }
        return (result as ApiResult.Error).message
    }

    /**
     * A transport failure must not reach the reader in OkHttp's words. Measured:
     * killing the server mid-submission put "unexpected end of stream on
     * http://...:5000/..." inside the attendance-code dialog, directly under the
     * line asking a student to type 8 digits.
     */
    @Test
    fun replaces_okhttp_transport_text_with_something_a_student_can_act_on() {
        val raw = "unexpected end of stream on http://localhost:5000/..."
        val message = messageForThrown(IOException(raw))
        assertEquals(NETWORK_MESSAGE, message)
        assertFalse(message.contains("stream"))
        assertFalse(message.contains("http"))
    }

    @Test
    fun every_transport_failure_reads_the_same_way() {
        assertEquals(NETWORK_MESSAGE, messageForThrown(java.net.SocketTimeoutException("timeout")))
        assertEquals(NETWORK_MESSAGE, messageForThrown(java.net.UnknownHostException("attendance.eng.pdn.ac.lk")))
        assertEquals(NETWORK_MESSAGE, messageForThrown(IOException(null as String?)))
    }

    @Test
    fun a_non_transport_failure_is_also_kept_out_of_the_ui() {
        assertEquals(UNEXPECTED_MESSAGE, messageForThrown(IllegalStateException("adapter blew up")))
    }

    /** A real server explanation must still come through untouched. */
    @Test
    fun the_servers_own_words_are_never_replaced() {
        assertEquals(
            "Incorrect code. Ask your lecturer to read it out again.",
            messageFor(400, """{"error":"Incorrect code. Ask your lecturer to read it out again."}"""),
        )
    }
}
