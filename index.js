import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js"
import { getDatabase, ref, child, push, onValue, remove } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js"
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, GithubAuthProvider, FacebookAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js"

const firebaseConfig = {
    apiKey: "AIzaSyDtO7WiaH5RHe5ixovVPx6U_JE1K6RmMw0",
    authDomain: "shopping-list-d3a29.firebaseapp.com",
    databaseURL: "https://shopping-list-d3a29-default-rtdb.europe-west1.firebasedatabase.app/",
    projectId: "shopping-list-d3a29",
    storageBucket: "shopping-list-d3a29.firebasestorage.app",
    messagingSenderId: "200152985790",
    appId: "1:200152985790:web:a0c473f5f821d523006eef"
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const googleProvider = new GoogleAuthProvider()
const githubProvider = new GithubAuthProvider()
const facebookProvider = new FacebookAuthProvider()
const database = getDatabase(app)

let shoppingListInDB = null
let unsubscribeShoppingList = null

const authControlsEl = document.getElementById("auth-controls")
const authStatusEl = document.getElementById("auth-status")
const authErrorEl = document.getElementById("auth-error")
const emailInputEl = document.getElementById("email-input")
const passwordInputEl = document.getElementById("password-input")
const createAccountButtonEl = document.getElementById("create-account-button")
const signInButtonEl = document.getElementById("sign-in-button")
const googleSignInButtonEl = document.getElementById("google-sign-in-button")
const githubSignInButtonEl = document.getElementById("github-sign-in-button")
const facebookSignInButtonEl = document.getElementById("facebook-sign-in-button")
const signOutButtonEl = document.getElementById("sign-out-button")
const shoppingListInterfaceEl = document.getElementById("shopping-list-interface")
const inputFieldEl = document.getElementById("input-field")
const addButtonEl = document.getElementById("add-button")
const shoppingListEl = document.getElementById("shopping-list")

createAccountButtonEl.addEventListener("click", async function() {
    await runAuthentication(createUserWithEmailAndPassword)
})

signInButtonEl.addEventListener("click", async function() {
    await runAuthentication(signInWithEmailAndPassword)
})

googleSignInButtonEl.addEventListener("click", async function() {
    clearAuthError()
    setAuthControlsDisabled(true)

    try {
        await signInWithPopup(auth, googleProvider)
    } catch (error) {
        showAuthError(error)
    } finally {
        setAuthControlsDisabled(false)
    }
})

githubSignInButtonEl.addEventListener("click", async function() {
    clearAuthError()
    setAuthControlsDisabled(true)

    try {
        await signInWithPopup(auth, githubProvider)
    } catch (error) {
        showAuthError(error)
    } finally {
        setAuthControlsDisabled(false)
    }
})

facebookSignInButtonEl.addEventListener("click", async function() {
    clearAuthError()
    setAuthControlsDisabled(true)

    try {
        await signInWithPopup(auth, facebookProvider)
    } catch (error) {
        showAuthError(error)
    } finally {
        setAuthControlsDisabled(false)
    }
})

signOutButtonEl.addEventListener("click", async function() {
    clearAuthError()
    signOutButtonEl.disabled = true

    try {
        await signOut(auth)
    } catch (error) {
        showAuthError(error)
    } finally {
        signOutButtonEl.disabled = false
    }
})

onAuthStateChanged(auth, function(user) {
    stopShoppingListListener()
    clearAuthError()

    if (user) {
        const userShoppingListInDB = ref(database, `users/${user.uid}/shoppingList`)

        shoppingListInDB = userShoppingListInDB
        unsubscribeShoppingList = onValue(userShoppingListInDB, function(snapshot) {
            if (shoppingListInDB !== userShoppingListInDB) {
                return
            }

            renderShoppingList(snapshot)
        }, function() {
            if (shoppingListInDB !== userShoppingListInDB) {
                return
            }

            clearShoppingListEl()
            shoppingListInDB = null
            unsubscribeShoppingList = null
            authErrorEl.textContent = "Unable to access your shopping list."
        })

        authStatusEl.textContent = user.email
            ? `Signed in as ${user.email}`
            : "Signed in."
        authControlsEl.hidden = true
        signOutButtonEl.hidden = false
        shoppingListInterfaceEl.hidden = false
        passwordInputEl.value = ""
    } else {
        authStatusEl.textContent = "No user is signed in."
        authControlsEl.hidden = false
        signOutButtonEl.hidden = true
        shoppingListInterfaceEl.hidden = true
        setAuthControlsDisabled(false)
    }
}, function(error) {
    showAuthError(error)
})

addButtonEl.addEventListener("click", function() {
    if (!shoppingListInDB) {
        authErrorEl.textContent = "Sign in to access your shopping list."
        return
    }

    let inputValue = inputFieldEl.value
    
    push(shoppingListInDB, inputValue)
    
    clearInputFieldEl()
})

function renderShoppingList(snapshot) {
    if (snapshot.exists()) {
        let itemsArray = Object.entries(snapshot.val())
    
        clearShoppingListEl()
        
        for (let i = 0; i < itemsArray.length; i++) {
            let currentItem = itemsArray[i]
            let currentItemID = currentItem[0]
            let currentItemValue = currentItem[1]
            
            appendItemToShoppingListEl(currentItem)
        }    
    } else {
        shoppingListEl.innerHTML = "No items here... yet"
    }
}

function stopShoppingListListener() {
    if (unsubscribeShoppingList) {
        unsubscribeShoppingList()
        unsubscribeShoppingList = null
    }

    shoppingListInDB = null
    clearShoppingListEl()
}

function clearShoppingListEl() {
    shoppingListEl.innerHTML = ""
}

function clearInputFieldEl() {
    inputFieldEl.value = ""
}

async function runAuthentication(authenticationMethod) {
    clearAuthError()

    const email = emailInputEl.value.trim()
    const password = passwordInputEl.value

    if (!email || !password) {
        authErrorEl.textContent = "Enter both an email address and password."
        return
    }

    setAuthControlsDisabled(true)

    try {
        await authenticationMethod(auth, email, password)
    } catch (error) {
        showAuthError(error)
    } finally {
        passwordInputEl.value = ""
        setAuthControlsDisabled(false)
    }
}

function setAuthControlsDisabled(disabled) {
    emailInputEl.disabled = disabled
    passwordInputEl.disabled = disabled
    createAccountButtonEl.disabled = disabled
    signInButtonEl.disabled = disabled
    googleSignInButtonEl.disabled = disabled
    githubSignInButtonEl.disabled = disabled
    facebookSignInButtonEl.disabled = disabled
}

function clearAuthError() {
    authErrorEl.textContent = ""
}

function showAuthError(error) {
    const errorMessages = {
        "auth/email-already-in-use": "An account already exists for this email address.",
        "auth/account-exists-with-different-credential": "An account already exists for this email using another sign-in method. Sign in with the original method.",
        "auth/cancelled-popup-request": "Another sign-in request is already in progress.",
        "auth/credential-already-in-use": "This sign-in credential is already associated with another user.",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/invalid-login-credentials": "The email address or password is incorrect.",
        "auth/invalid-credential": "The email address or password is incorrect.",
        "auth/internal-error": "Sign-in could not be completed. Please try again.",
        "auth/missing-password": "Enter a password.",
        "auth/network-request-failed": "Unable to connect. Check your internet connection and try again.",
        "auth/operation-not-allowed": "This sign-in method is not enabled for this application.",
        "auth/popup-blocked": "The sign-in popup was blocked. Allow popups and try again.",
        "auth/popup-closed-by-user": "Sign-in was cancelled before it was completed.",
        "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
        "auth/unauthorized-domain": "This sign-in method is not available from this domain.",
        "auth/user-disabled": "This account has been disabled.",
        "auth/user-not-found": "The email address or password is incorrect.",
        "auth/weak-password": "Use a password with at least six characters.",
        "auth/web-storage-unsupported": "This browser cannot complete sign-in because web storage is unavailable.",
        "auth/wrong-password": "The email address or password is incorrect."
    }

    authErrorEl.textContent = errorMessages[error.code] || "Authentication failed. Please try again."
}

function appendItemToShoppingListEl(item) {
    let itemID = item[0]
    let itemValue = item[1]
    const itemListInDB = shoppingListInDB
    
    let newEl = document.createElement("li")
    
    newEl.textContent = itemValue
    
    newEl.addEventListener("dblclick", function() {
        if (!itemListInDB || shoppingListInDB !== itemListInDB) {
            return
        }

        let exactLocationOfItemInDB = child(itemListInDB, itemID)
        
        remove(exactLocationOfItemInDB)
    })
    
    shoppingListEl.append(newEl)
}
