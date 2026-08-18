package lk.ac.pdn.eng.feats

import lk.ac.pdn.eng.feats.ble.BleUuid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.UUID

/** Verifies the token <-> service-UUID packing matches the web app's bleToken.js. */
class BleUuidTest {

    @Test
    fun packs_token_into_uuid_with_uopa_prefix() {
        val token = "a1b2c3d4e5f60718"
        val uuid = BleUuid.tokenToUuid(token)
        // 554f5041-a1b2-c3d4-e5f6-071800000000
        assertEquals("554f5041-a1b2-c3d4-e5f6-071800000000", uuid.toString())
    }

    @Test
    fun round_trips_token() {
        val token = "0123456789abcdef"
        val uuid = BleUuid.tokenToUuid(token)
        assertEquals(token, BleUuid.uuidToToken(uuid))
    }

    @Test
    fun rejects_non_uopa_uuid() {
        val foreign = UUID.fromString("00001234-0000-1000-8000-00805f9b34fb")
        assertNull(BleUuid.uuidToToken(foreign))
    }

    @Test
    fun extracts_first_matching_token_from_list() {
        val foreign = UUID.fromString("00001234-0000-1000-8000-00805f9b34fb")
        val ours = BleUuid.tokenToUuid("feedface00112233")
        assertEquals("feedface00112233", BleUuid.extractToken(listOf(foreign, ours)))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejects_bad_token_length() {
        BleUuid.tokenToUuid("tooshort")
    }
}
