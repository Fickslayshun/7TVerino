import gql from "graphql-tag";

export const twitchRedeemCustomRewardMut = gql`
	mutation RedeemCustomReward($input: RedeemCommunityPointsCustomRewardInput!) {
		redeemCommunityPointsCustomReward(input: $input) {
			error {
				code
			}
			redemption {
				id
			}
		}
	}
`;

export namespace twitchRedeemCustomRewardMut {
	export interface Variables {
		input: {
			channelID: string;
			cost: number;
			prompt?: string | null;
			rewardID: string;
			title: string;
			transactionID: string;
			textInput?: string | null;
		};
	}

	export interface Response {
		redeemCommunityPointsCustomReward: {
			error: {
				code: string;
			} | null;
			redemption: {
				id: string;
			} | null;
		} | null;
	}
}
