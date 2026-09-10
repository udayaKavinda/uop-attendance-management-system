package lk.ac.pdn.eng.feats

import lk.ac.pdn.eng.feats.ui.auth.OAuthReturn
import lk.ac.pdn.eng.feats.ui.auth.oauthReturnFrom
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The browser sign-in flow reports its outcome only through the deep link, so
 * anything this mapper drops the user never hears about. It previously dropped
 * every failure.
 */
class OAuthReturnTest {

    @Test
    fun a_code_wins() {
        assertEquals(OAuthReturn.Code("abc"), oauthReturnFrom("abc", null, null))
    }

    @Test
    fun a_rejected_domain_names_the_domain_and_does_not_tell_the_user_to_retry() {
        val result = oauthReturnFrom(null, "domain", "eng.pdn.ac.lk") as OAuthReturn.Failure
        assertTrue(result.message.contains("@eng.pdn.ac.lk"))
        assertTrue(result.message.contains("administrator"))
        assertTrue("must not advise a pointless retry", !result.message.contains("try again"))
    }

    @Test
    fun a_rejected_domain_still_explains_itself_when_the_domain_is_missing() {
        val result = oauthReturnFrom(null, "domain", null) as OAuthReturn.Failure
        assertTrue(result.message.contains("not eligible"))
    }

    @Test
    fun other_known_reasons_get_their_own_copy() {
        assertTrue((oauthReturnFrom(null, "no_email", null) as OAuthReturn.Failure).message.contains("email address"))
        assertTrue((oauthReturnFrom(null, "session", null) as OAuthReturn.Failure).message.contains("session"))
    }

    @Test
    fun an_unknown_reason_still_surfaces_something() {
        assertEquals(
            OAuthReturn.Failure("Sign-in failed. Please try again."),
            oauthReturnFrom(null, "something-new", null),
        )
    }

    @Test
    fun a_link_carrying_neither_is_ignored() {
        assertNull(oauthReturnFrom(null, null, null))
        assertNull(oauthReturnFrom("", "", null))
    }
}
