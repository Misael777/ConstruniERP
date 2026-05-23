<!-- Sidebar component -->
<div class="sidebar">
  <div class="logo">
    <!-- Logo content -->
  </div>
  <nav class="menu">
    <ul>
      <li><a href="/dashboard">Dashboard</a></li>
      <li><a href="/finanzas">Finanzas</a></li>
      <li><a href="/ventas">Ventas</a></li>
      <li><a href="/iam">IAM</a></li>
    </ul>
  </nav>
  <!-- Add the following section for CRUD buttons -->
  <div class="actions">
    <button @click={openModal}>Nuevo Usuario</button>
    <!-- Add more actions as needed -->
  </div>
</div>

<script>
import { onMount } from 'svelte';
import { supabase } from '$lib/server/supabaseClient';

let showModal = false;

onMount(async () => {
  // Fetch users data to populate the table
  const { data: users, error } = await supabase.from('users').select('*');
  if (error) console.error(error);
});

function openModal() {
  showModal = true;
}
</script>

<style>
/* Sidebar styles */
.sidebar {
  /* Add your styles here */
}

.logo {
  /* Add your styles here */
}

.menu {
  /* Add your styles here */
}

.actions {
  /* Add your styles here */
}
</style>
