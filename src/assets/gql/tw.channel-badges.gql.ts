import gql from "graphql-tag";
import { twitchBadgeFragment } from "./tw.fragment.gql";

export const twitchChannelBadgesQuery = gql`
	query ChannelBadges($login: String!) {
		badges {
			...badge
			__typename
		}
		user(login: $login) {
			id
			login
			broadcastBadges {
				...badge
				__typename
			}
		}
	}

	${twitchBadgeFragment}
`;

export namespace twitchChannelBadgesQuery {
	export interface Variables {
		login: string;
	}

	export interface Response {
		badges: Twitch.ChatBadge[];
		user: {
			id: string;
			login: string;
			broadcastBadges: Twitch.ChatBadge[];
		} | null;
	}
}
