import gql from "graphql-tag";

export const twitchSelectGlobalBadgeMut = gql`
	mutation SelectGlobalBadge($input: SelectGlobalBadgeInput!) {
		selectGlobalBadge(input: $input) {
			user {
				id
			}
		}
	}
`;

export namespace twitchSelectGlobalBadgeMut {
	export interface Variables {
		input: {
			badgeSetID: string;
			badgeSetVersion?: string;
		};
	}

	export interface Response {
		selectGlobalBadge: {
			user: {
				id: string;
			} | null;
		} | null;
	}
}

export const twitchSelectChannelBadgeMut = gql`
	mutation SelectChannelBadge($input: SelectChannelBadgeInput!) {
		selectChannelBadge(input: $input) {
			user {
				id
			}
		}
	}
`;

export namespace twitchSelectChannelBadgeMut {
	export interface Variables {
		input: {
			channelID: string;
			badgeSetID: string;
			badgeSetVersion?: string;
		};
	}

	export interface Response {
		selectChannelBadge: {
			user: {
				id: string;
			} | null;
		} | null;
	}
}

export const twitchSelectChannelAuthorityBadgeMut = gql`
	mutation SelectChannelAuthorityBadge($input: SelectChannelAuthorityBadgeInput!) {
		selectChannelAuthorityBadge(input: $input) {
			user {
				id
			}
		}
	}
`;

export namespace twitchSelectChannelAuthorityBadgeMut {
	export interface Variables {
		input: {
			channelID: string;
			badgeSetID: string;
			badgeSetVersion?: string;
		};
	}

	export interface Response {
		selectChannelAuthorityBadge: {
			user: {
				id: string;
			} | null;
		} | null;
	}
}
