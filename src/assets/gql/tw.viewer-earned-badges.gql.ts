import { twitchBadgeFragment } from "./tw.fragment.gql";
import gql from "graphql-tag";

export const twitchViewerEarnedBadgesQuery = gql`
	query ViewerEarnedBadges(
		$channelLogin: String!
		$targetLogin: String!
		$isViewerBadgeCollectionEnabled: Boolean!
	) {
		channelViewer(userLogin: $targetLogin, channelLogin: $channelLogin) {
			id
			earnedBadges @include(if: $isViewerBadgeCollectionEnabled) {
				...badge
				description
			}
		}
	}

	${twitchBadgeFragment}
`;

export namespace twitchViewerEarnedBadgesQuery {
	export interface Variables {
		channelLogin: string;
		targetLogin: string;
		isViewerBadgeCollectionEnabled: boolean;
	}

	export interface Response {
		channelViewer: {
			id: string;
			earnedBadges: Twitch.ChatBadge[];
		} | null;
	}
}
