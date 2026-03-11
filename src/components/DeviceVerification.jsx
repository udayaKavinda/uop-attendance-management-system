import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { verifyDevice, getWebAuthnOptions, verifyWebAuthnRegistration, verifyWebAuthnAssertion } from '../api';

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
      setError('This browser does not support biometric verification. Use the photo option instead.');
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
        const verifyResp = await verifyWebAuthnRegistration(studentId, credential);
        if (!verifyResp.verified) {
          setError(verifyResp.error || 'Registration verification failed');
          setLoading(false);
          return;
        }
      } else if (type === 'authentication') {
        const assertion = await startAuthentication({ optionsJSON: options });
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

  const handlePhoto = async () => {
    const student = JSON.parse(localStorage.getItem('student') || '{}');
    const res = await verifyDevice({
      studentId: student.studentId,
      method: 'photo',
    });
    if (res.success) {
      const current = JSON.parse(localStorage.getItem('student') || '{}');
      localStorage.setItem('student', JSON.stringify({ ...current, studentId: student.studentId, deviceMethod: 'photo' }));
      navigate('/lecture');
    } else {
      setError(res.error || 'Photo verification failed');
    }
  };

  return (
    <div className="container">
      <h2>Device verification</h2>
      <p>Use your registered device or fall back to a live photo.</p>
      {error && <p className="error" style={{ color: 'red' }}>{error}</p>}
      <button
        onClick={handleWebAuthn}
        disabled={loading || !webauthnAvailable}
      >
        {loading ? 'Verifying…' : 'Use biometrics (WebAuthn)'}
      </button>
      {!webauthnAvailable && (
        <p style={{ fontSize: '0.9rem', color: '#666' }}>
          Biometrics not supported in this browser. Use HTTPS or localhost.
        </p>
      )}
      <button onClick={handlePhoto} disabled={loading}>
        Use camera/photo
      </button>
    </div>
  );
}
