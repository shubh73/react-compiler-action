// This hook intentionally opts out of compilation
export function useCustomHook(callback: () => void, deps: unknown[]) {
	"use no memo";

	// Intentionally unconventional hook usage
	return { callback, deps };
}
