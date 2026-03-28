// This component follows the Rules of React and should be optimized
export function GoodComponent({ name }: { name: string }) {
	const greeting = `Hello, ${name}!`;
	return <div>{greeting}</div>;
}

export function AnotherGoodOne({ count }: { count: number }) {
	const doubled = count * 2;
	return <span>{doubled}</span>;
}
