import { twitchBadgeFragment } from "./tw.fragment.gql";
import gql from "graphql-tag";

export const twitchViewerChatBadgePickerQuery = gql`
	query ViewerChatBadgePicker(
		$channelID: ID!
		$channelLogin: String!
		$targetLogin: String!
		$isViewerBadgeCollectionEnabled: Boolean!
	) {
		targetUser: user(login: $targetLogin, lookupType: ALL) {
			id
			globalDisplayBadges: displayBadges {
				...badge
				description
			}
			channelDisplayBadges: displayBadges(channelID: $channelID) {
				...badge
				description
			}
			relationship(targetUserID: $channelID) {
				cumulativeTenure: subscriptionTenure(tenureMethod: CUMULATIVE) {
					months
					daysRemaining
				}
				subscriptionBenefit {
					id
					tier
					purchasedWithPrime
					gift {
						isGift
					}
				}
			}
		}
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

export namespace twitchViewerChatBadgePickerQuery {
	export interface Variables {
		channelID: string;
		channelLogin: string;
		targetLogin: string;
		isViewerBadgeCollectionEnabled: boolean;
	}

	export interface Response {
		targetUser: {
			id: string;
			globalDisplayBadges: Twitch.ChatBadge[];
			channelDisplayBadges: Twitch.ChatBadge[];
			relationship: {
				cumulativeTenure: {
					months: number;
					daysRemaining: number;
				} | null;
				subscriptionBenefit: {
					id: string;
					tier: string;
					purchasedWithPrime: boolean;
					gift: {
						isGift: boolean;
					} | null;
				} | null;
			} | null;
		} | null;
		channelViewer: {
			id: string;
			earnedBadges: Twitch.ChatBadge[];
		} | null;
	}
}
