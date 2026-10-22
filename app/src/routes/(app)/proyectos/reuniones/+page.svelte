<script lang="ts">
	import SubmoduloEnPreparacion from '$lib/modules/proyectos/components/SubmoduloEnPreparacion.svelte';
</script>

<SubmoduloEnPreparacion
	titulo="Reuniones, acuerdos y mejoras"
	descripcion="Registro de reuniones de proyecto, los acuerdos tomados y las mejoras propuestas."
	columnas={['Fecha', 'Proyecto', 'Tema', 'Acuerdos / mejoras', 'Responsable', 'Estado']}
	textoBuscador="Buscar por proyecto, tema o responsable..."
	textoVacio="Todavía no hay reuniones registradas."
/>
