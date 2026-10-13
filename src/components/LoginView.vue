<script setup lang="ts">
import { ref } from 'vue';
import { login } from '../api';
const emit = defineEmits<{ signedIn: [] }>();
const password = ref(''); const error = ref(''); const busy = ref(false);
async function submit() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { await login(password.value); password.value = ''; emit('signedIn'); }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not sign in'; }
  finally { busy.value = false; }
}
</script>
<template>
  <main class="login-screen"><form @submit.prevent="submit" class="login-card">
    <span class="eyebrow">YOUR GARDEN, THROUGH THE SEASONS</span><h1>TuinApp</h1>
    <p>Sign in to your plants, plans, and garden notes.</p>
    <label for="password">Password</label><input id="password" v-model="password" type="password" autocomplete="current-password" required autofocus />
    <p v-if="error" class="error" role="alert">{{ error }}</p><button type="submit" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
  </form></main>
</template>
<style scoped>
.login-screen {min-height:100vh;display:grid;place-items:center;background:#f2f4ee;}.login-card {width:430px;padding:42px;background:white;border:1px solid #dce2d5;border-radius:12px;box-shadow:0 14px 40px #263c2210;}.eyebrow {color:#547147;letter-spacing:.12em;font-size:10px;font-weight:700;}h1 {font-size:36px;margin:12px 0;color:#2b4028;}p {color:#697263;line-height:1.6;margin-bottom:24px;}label {display:block;margin-bottom:8px;font-weight:600;}input {width:100%;padding:12px;border:1px solid #c8d0c1;border-radius:5px;margin-bottom:18px;}button {width:100%;background:#386145;color:white;padding:12px;border:0;border-radius:5px;font-weight:600;cursor:pointer;}.error {color:#9e3028;}
@media (max-width: 480px) { .login-screen { min-height:100dvh; padding:16px; } .login-card { width:100%; max-width:430px; padding:28px 22px; } h1 { font-size:30px; } }
</style>
