import { gql } from "graphql-tag";

export const actorQuery = gql`
	query GetActor {
		user: actor {
			id
			username
			display_name
			avatar_url
			style {
				color
				paint_id
			}
			connections {
				id
				username
				display_name
			}
		}
	}
`;

export const actorCosmeticInventoryQuery = gql`
	query GetActorCosmeticInventory {
		user: actor {
			id
			username
			style {
				paint_id
				badge_id
			}
			cosmetics {
				id
				kind
				selected
			}
		}
	}
`;

export const cosmeticsByIDQuery = gql`
	query GetCosmeticsByID($list: [ObjectID!]) {
		inventory: cosmetics(list: $list) {
			paints {
				id
				name
				color
				gradients {
					function
					canvas_repeat
					size: canvas_size
					at
					stops {
						at
						color
					}
					image_url
					shape
					angle
					repeat
				}
				shadows {
					x_offset
					y_offset
					radius
					color
				}
				text {
					weight
					transform
					stroke {
						color
						width
					}
					shadows {
						x_offset
						y_offset
						radius
						color
					}
				}
			}
			badges {
				id
				name
				tag
				tooltip
				host {
					url
					files {
						name
						format
						width
						height
					}
				}
			}
		}
	}
`;

export const actorCosmeticInventoryV4QueryText = /* GraphQL */ `
	query GetActorCosmeticInventoryV4 {
		users {
			me {
				inventory {
					paints {
						to {
							paintId
							paint {
								id
								name
								data {
									layers {
										id
										opacity
										ty {
											__typename
											... on PaintLayerTypeSingleColor {
												color {
													r
													g
													b
													a
													hex
												}
											}
											... on PaintLayerTypeLinearGradient {
												angle
												repeating
												stops {
													at
													color {
														r
														g
														b
														a
														hex
													}
												}
											}
											... on PaintLayerTypeRadialGradient {
												repeating
												shape
												stops {
													at
													color {
														r
														g
														b
														a
														hex
													}
												}
											}
											... on PaintLayerTypeImage {
												images {
													url
													mime
													size
													scale
													width
													height
													frameCount
												}
											}
										}
									}
									shadows {
										color {
											hex
										}
										offsetX
										offsetY
										blur
									}
								}
							}
						}
					}
					badges {
						to {
							badgeId
							badge {
								id
								name
								images {
									url
									mime
									size
									scale
									width
									height
									frameCount
								}
							}
						}
					}
				}
			}
		}
	}
`;

export const updateSelectedCosmeticMutation = gql`
	mutation UpdateSelectedCosmetic($id: ObjectID!, $update: UserCosmeticUpdate!) {
		user(id: $id) {
			cosmetics(update: $update)
		}
	}
`;

export const userQuery = gql`
	query GetUser($id: ObjectID!) {
		user: user(id: $id) {
			id
			username
			display_name
			avatar_url
			style {
				color
				paint_id
			}
		}
	}
`;

export const userByConnectionQuery = gql`
	query GetUserByConnection($platform: ConnectionPlatform!, $id: String!) {
		user: userByConnection(platform: $platform, id: $id) {
			id
			username
			display_name
			avatar_url
			style {
				color
				paint_id
			}
			connections {
				platform
				emote_set_id
			}
			editors {
				id
			}
			editor_of {
				id
				permissions
			}
			roles
		}
	}
`;

export const changeEmoteInSetMutation = gql`
	mutation ChangeEmoteInSet($id: ObjectID!, $action: ListItemAction!, $emote_id: ObjectID!, $name: String) {
		emoteSet(id: $id) {
			id
			emotes(id: $emote_id, action: $action, name: $name) {
				id
				name
			}
		}
	}
`;

export const searchQuery = gql`
	query SearchEmotes($query: String!, $page: Int, $sort: Sort, $limit: Int, $filter: EmoteSearchFilter) {
		emotes(query: $query, page: $page, sort: $sort, limit: $limit, filter: $filter) {
			count
			items {
				id
				name
				state
				trending
				owner {
					id
					username
					display_name
					style {
						color
						paint_id
					}
				}
				flags
				host {
					url
					files {
						name
						format
						width
						height
					}
				}
			}
		}
	}
`;

export namespace userQuery {
	export interface Result {
		user: SevenTV.User;
	}
	export interface Variables {
		id: string;
	}
}

export namespace actorQuery {
	export interface Result {
		user: SevenTV.User;
	}
}

export namespace actorCosmeticInventoryQuery {
	export interface UserCosmeticSelection {
		id: string;
		kind: SevenTV.CosmeticKind;
		selected: boolean;
	}

	export interface Result {
		user: {
			id: string;
			username: string;
			style: {
				paint_id?: string | null;
				badge_id?: string | null;
			} | null;
			cosmetics: UserCosmeticSelection[];
		} | null;
	}
}

export namespace cosmeticsByIDQuery {
	export interface Variables {
		list?: string[];
	}

	export interface Result {
		inventory: {
			paints: Array<{
				id: string;
				name: string;
				color: number | null;
				gradients: SevenTV.CosmeticPaintGradient[];
				shadows?: SevenTV.CosmeticPaintShadow[] | null;
				text?: SevenTV.CosmeticPaintText | null;
			}>;
			badges: Array<{
				id: string;
				name: string;
				tag?: string | null;
				tooltip?: string | null;
				host: SevenTV.ImageHost;
			}>;
		} | null;
	}
}

export namespace actorCosmeticInventoryV4Query {
	export interface Paint {
		id: string;
		name: string;
		data: {
			layers: SevenTV.CosmeticPaintLayer[];
			shadows: Array<{
				color: Pick<SevenTV.CosmeticColor, "hex">;
				offsetX: number;
				offsetY: number;
				blur: number;
			}>;
		};
	}

	export interface Badge {
		id: string;
		name: string;
		images: SevenTV.CosmeticAssetImage[];
	}

	export interface Result {
		users: {
			me: {
				inventory: {
					paints: Array<{
						to: {
							paintId: string;
							paint: Paint | null;
						} | null;
					}>;
					badges: Array<{
						to: {
							badgeId: string;
							badge: Badge | null;
						} | null;
					}>;
				} | null;
			} | null;
		} | null;
	}
}

export namespace updateSelectedCosmeticMutation {
	export interface Variables {
		id: string;
		update: {
			id: string;
			kind: SevenTV.CosmeticKind;
			selected: boolean;
		};
	}

	export interface Result {
		user: {
			cosmetics: boolean;
		} | null;
	}
}
