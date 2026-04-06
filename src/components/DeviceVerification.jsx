import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { verifyDevice, getWebAuthnOptions, verifyWebAuthnRegistration, verifyWebAuthnAssertion } from '../api';

const USER_VERIFY_PRESENCE_ONLY = 0x01;
const USER_VERIFY_FINGERPRINT = 0x02;
const USER_VERIFY_FACEPRINT = 0x08;
const USER_VERIFY_PASSCODE = 0x04;

function rejectIfNotBiometric(webauthnResponse) {
  const uvm = webauthnResponse?.clientExtensionResults?.uvm;
  if (!uvm || !Array.isArray(uvm) || uvm.length === 0) {
    return 'Biometric verification is required. This browser did not provide method details (UVM), so verification is blocked.';
  }

  for (const entry of uvm) {
    const methodField = Array.isArray(entry) ? entry[0] : entry?.userVerificationMethod ?? entry;
    const method = typeof methodField === 'number' ? methodField : parseInt(methodField, 10);
    if (Number.isNaN(method)) {
      return 'Could not determine biometric method. Verification is blocked.';
    }
    if ((method & USER_VERIFY_PASSCODE) === USER_VERIFY_PASSCODE) {
      return 'PIN/passcode was used. Only fingerprint or Face ID is allowed.';
    }
    if ((method & USER_VERIFY_PRESENCE_ONLY) === USER_VERIFY_PRESENCE_ONLY) {
      return 'Presence-only verification is not allowed. Use fingerprint or Face ID.';
    }
    const biometricOk = (method & USER_VERIFY_FINGERPRINT) === USER_VERIFY_FINGERPRINT
      || (method & USER_VERIFY_FACEPRINT) === USER_VERIFY_FACEPRINT;
    if (!biometricOk) {
      return 'Only fingerprint or Face ID is allowed.';
    }
  }

  return null;
}

export default function DeviceVerification() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [webauthnAvailable, setWebauthnAvailable] = useState(true);

  useEffect(() => {
    setWebauthnAvailable(browserSupportsWebAuthn());
  }, []);

  const handleWebAuthn = async () => {
    const student = JSON.parse(localStorage.getItem('student') || '{}');
    const studentId = student.studentId;
    if (!studentId) {
      setError('Not signed in. Please sign in with Google first.');
      return;
    }
    if (!webauthnAvailable) {
      setError('Biometric verification is required. This browser or device does not support it. Use a supported device (e.g. fingerprint or Face ID).');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const optsResp = await getWebAuthnOptions(studentId);
      if (optsResp.error) {
        setError(optsResp.error);
        setLoading(false);
        return;
      }

      const { type, options } = optsResp;
      if (!options) {
        setError('Failed to get verification options');
        setLoading(false);
        return;
      }

      if (type === 'registration') {
        const credential = await startRegistration({ optionsJSON: options });
        const localReject = rejectIfNotBiometric(credential);
        if (localReject) {
          setError(localReject);
          setLoading(false);
          return;
        }
        const verifyResp = await verifyWebAuthnRegistration(studentId, credential);
        if (!verifyResp.verified) {
          setError(verifyResp.error || 'Registration verification failed');
          setLoading(false);
          return;
        }
      } else if (type === 'authentication') {
        const assertion = await startAuthentication({ optionsJSON: options });
        const localReject = rejectIfNotBiometric(assertion);
        if (localReject) {
          setError(localReject);
          setLoading(false);
          return;
        }
        const verifyResp = await verifyWebAuthnAssertion(studentId, assertion);
        if (!verifyResp.verified) {
          setError(verifyResp.error || 'Biometric verification failed');
          setLoading(false);
          return;
        }
      } else {
        setError('Unknown verification type');
        setLoading(false);
        return;
      }

      const res = await verifyDevice({ studentId, method: 'webauthn' });
      if (res.success) {
        const current = JSON.parse(localStorage.getItem('student') || '{}');
        localStorage.setItem('student', JSON.stringify({ ...current, studentId, deviceMethod: 'webauthn' }));
        navigate('/lecture');
      } else {
        setError(res.error || 'Could not complete verification');
      }
    } catch (err) {
      if (err.name === 'InvalidStateError') {
        setError('This device is already registered. Try "Use biometrics" again to sign in.');
      } else if (err.name === 'NotAllowedError') {
        setError('Verification was cancelled or timed out.');
      } else {
        setError(err.message || 'Biometric verification failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h2>Biometric verification required</h2>
      <p>Verify your identity with fingerprint or Face ID only. PIN or passcode is not accepted.</p>
      {error && <p className="error" style={{ color: 'red' }}>{error}</p>}
      <button
        onClick={handleWebAuthn}
        disabled={loading || !webauthnAvailable}
      >
        {loading ? 'Verifying…' : 'Verify with fingerprint or Face ID'}
      </button>
      {!webauthnAvailable && (
        <p style={{ fontSize: '0.9rem', color: '#666' }}>
          Biometrics not supported in this browser or context. Use HTTPS or localhost on a device with fingerprint/Face ID.
        </p>
      )}
    </div>
  );
}
