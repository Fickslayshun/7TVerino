<template>
	<span class="seventv-basic-system-message"> {{ text }} </span>
</template>

<script setup lang="ts">
defineProps<{
	text: string;
}>();
</script>

<style scoped lang="scss">
span.seventv-basic-system-message {
	display: block;
	width: 100%;
	max-width: 100%;
	box-sizing: border-box;
	padding: 0.5rem 2rem;
	color: var(--seventv-muted);
	white-space: normal;
	overflow-wrap: anywhere;
	word-break: break-word;
}
</style>
