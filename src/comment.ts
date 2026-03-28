import * as github from "@actions/github";

const COMMENT_MARKER = "<!-- react-compiler-action -->";

type Octokit = ReturnType<typeof github.getOctokit>;

async function findExistingComment(
	octokit: Octokit,
	owner: string,
	repo: string,
	prNumber: number,
): Promise<{ id: number } | null> {
	const iterator = octokit.paginate.iterator(
		octokit.rest.issues.listComments,
		{ owner, repo, issue_number: prNumber, per_page: 100 },
	);

	for await (const { data: comments } of iterator) {
		const existing = comments.find((c) => c.body?.startsWith(COMMENT_MARKER));
		if (existing) return { id: existing.id };
	}

	return null;
}

export async function upsertComment(
	token: string,
	prNumber: number,
	report: string | null,
): Promise<number | null> {
	const octokit = github.getOctokit(token);
	const { owner, repo } = github.context.repo;

	const existing = await findExistingComment(octokit, owner, repo, prNumber);

	if (!report && !existing) return null;

	if (!report && existing) {
		await octokit.rest.issues.deleteComment({
			owner,
			repo,
			comment_id: existing.id,
		});
		return null;
	}

	const body = `${COMMENT_MARKER}\n${report}`;

	if (existing) {
		await octokit.rest.issues.updateComment({
			owner,
			repo,
			comment_id: existing.id,
			body,
		});
		return existing.id;
	}

	const { data } = await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: prNumber,
		body,
	});

	return data.id;
}
