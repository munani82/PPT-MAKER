import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    // Handle cases where the user closed the popup or it was blocked
    if (error.code === 'auth/popup-closed-by-user') {
      console.warn("Sign-in popup was closed by the user.");
      return null;
    }
    if (error.code === 'auth/cancelled-popup-request') {
      console.warn("Sign-in request was cancelled (likely multiple clicks).");
      return null;
    }
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

export const logout = () => signOut(auth);
