import { computed, reactive } from "vue";

const state = reactive({
	openRows: new Set<symbol>(),
	userRows: new Map<string, symbol>(),
	rowUsers: new Map<symbol, string>(),
	version: 0,
});

function markDirty(): void {
	state.version += 1;
}

export function useOpenUserCards() {
	return {
		openRows: state.openRows,
		version: computed(() => state.version),
		isOpen(sym: symbol): boolean {
			return state.openRows.has(sym);
		},
		open(sym: symbol, userKey?: string | null): void {
			const normalizedUserKey = userKey?.trim();
			if (!normalizedUserKey) {
				if (state.openRows.has(sym)) return;

				state.openRows.add(sym);
				markDirty();
				return;
			}

			const prevRow = state.userRows.get(normalizedUserKey);
			if (prevRow === sym && state.openRows.has(sym)) return;

			if (prevRow) {
				state.openRows.delete(prevRow);
				state.rowUsers.delete(prevRow);
			}

			const prevUser = state.rowUsers.get(sym);
			if (prevUser && prevUser !== normalizedUserKey) {
				state.userRows.delete(prevUser);
			}

			state.openRows.add(sym);
			state.userRows.set(normalizedUserKey, sym);
			state.rowUsers.set(sym, normalizedUserKey);
			markDirty();
		},
		close(sym: symbol): void {
			if (!state.openRows.delete(sym)) return;

			const userKey = state.rowUsers.get(sym);
			if (userKey) {
				state.userRows.delete(userKey);
				state.rowUsers.delete(sym);
			}
			markDirty();
		},
	};
}
