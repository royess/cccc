//! Account-owned navigation preferences. No Group, Actor or task mutation.
use crate::{
    AppState,
    api::{ApiError, ApiResult, success},
    auth::Principal,
};
use axum::{
    Json, Router,
    extract::{Extension, State},
    routing::get,
};
use cccc_core::{HomeLayout, integration_state};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, io};
const KEY: &str = "web_sidebar_preferences";
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Folder {
    id: String,
    name: String,
    #[serde(default)]
    group_ids: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Preferences {
    revision: u64,
    folders: Vec<Folder>,
    group_order: Vec<String>,
    archived_group_ids: Vec<String>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Record {
    preferences: Preferences,
    applied: Vec<String>,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Operation {
    Seed {
        preferences: Preferences,
    },
    CreateFolder {
        id: String,
        name: String,
        #[serde(default)]
        group_ids: Vec<String>,
    },
    RenameFolder {
        id: String,
        name: String,
    },
    FolderMembership {
        id: String,
        group_id: String,
        included: bool,
    },
    DeleteFolder {
        id: String,
    },
    MoveFolder {
        id: String,
        before_id: Option<String>,
    },
    Archive {
        group_id: String,
        archived: bool,
    },
    Reorder {
        from_id: String,
        to_id: String,
        after: bool,
        archived: bool,
        known_ids: Vec<String>,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    client_id: String,
    user_id: String,
    operation: Operation,
}
pub fn routes() -> Router<AppState> {
    Router::new().route("/api/v1/user/sidebar", get(read).patch(write))
}
fn ids(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    *values = values
        .iter()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty() && seen.insert(v.clone()))
        .collect();
}
fn normalize(p: &mut Preferences) {
    let mut seen = HashSet::new();
    p.folders.retain(|f| {
        !f.id.trim().is_empty() && !f.name.trim().is_empty() && seen.insert(f.id.clone())
    });
    for f in &mut p.folders {
        f.name = f.name.trim().into();
        ids(&mut f.group_ids);
    }
    ids(&mut p.group_order);
    ids(&mut p.archived_group_ids);
}
fn apply(p: &mut Preferences, op: Operation, initialized: bool) {
    match op {
        Operation::Seed { preferences } if !initialized => *p = preferences,
        Operation::Seed { .. } => {}
        Operation::CreateFolder {
            id,
            name,
            group_ids,
        } => {
            if !p.folders.iter().any(|f| f.id == id) {
                p.folders.push(Folder {
                    id,
                    name,
                    group_ids,
                });
            }
        }
        Operation::RenameFolder { id, name } => {
            if !name.trim().is_empty() {
                if let Some(f) = p.folders.iter_mut().find(|f| f.id == id) {
                    f.name = name;
                }
            }
        }
        Operation::FolderMembership {
            id,
            group_id,
            included,
        } => {
            if let Some(f) = p.folders.iter_mut().find(|f| f.id == id) {
                f.group_ids.retain(|v| v != &group_id);
                if included {
                    f.group_ids.push(group_id);
                }
            }
        }
        Operation::DeleteFolder { id } => p.folders.retain(|f| f.id != id),
        Operation::MoveFolder { id, before_id } => {
            if before_id.as_ref() != Some(&id) {
                if let Some(from) = p.folders.iter().position(|f| f.id == id) {
                    let folder = p.folders.remove(from);
                    let to = before_id
                        .and_then(|target| p.folders.iter().position(|f| f.id == target))
                        .unwrap_or(p.folders.len());
                    p.folders.insert(to, folder);
                }
            }
        }
        Operation::Archive { group_id, archived } => {
            p.archived_group_ids.retain(|v| v != &group_id);
            if archived {
                p.archived_group_ids.push(group_id);
            }
        }
        Operation::Reorder {
            from_id,
            to_id,
            after,
            archived,
            known_ids,
        } => {
            for id in known_ids {
                if !p.group_order.contains(&id) {
                    p.group_order.push(id);
                }
            }
            let mut subset: Vec<_> = p
                .group_order
                .iter()
                .filter(|id| p.archived_group_ids.contains(id) == archived)
                .cloned()
                .collect();
            if let (Some(from), Some(to)) = (
                subset.iter().position(|id| id == &from_id),
                subset.iter().position(|id| id == &to_id),
            ) {
                if from != to {
                    let id = subset.remove(from);
                    let target = subset
                        .iter()
                        .position(|v| v == &to_id)
                        .unwrap_or(to.min(subset.len()));
                    subset.insert((target + usize::from(after)).min(subset.len()), id);
                }
                let mut next = subset.into_iter();
                for id in &mut p.group_order {
                    if p.archived_group_ids.contains(id) == archived {
                        if let Some(value) = next.next() {
                            *id = value;
                        }
                    }
                }
            }
        }
    }
    normalize(p);
}
fn read_user(home: &HomeLayout, user: &str) -> io::Result<Value> {
    let all = integration_state::global_get(home, KEY)?;
    let initialized = all.get(user).is_some();
    let record: Record = if let Some(value) = all.get(user) {
        serde_json::from_value(value.clone()).map_err(io::Error::other)?
    } else {
        Record::default()
    };
    Ok(json!({"userId":user,"initialized":initialized,"preferences":record.preferences}))
}
fn write_user(home: &HomeLayout, user: &str, change: Change) -> io::Result<Value> {
    integration_state::global_update(home, KEY, |all| {
        if all.is_null() {
            *all = json!({});
        }
        let map = all
            .as_object_mut()
            .ok_or_else(|| io::Error::other("sidebar preference store is not an object"))?;
        let initialized = map.contains_key(user);
        let mut record: Record = match map.get(user) {
            Some(value) => serde_json::from_value(value.clone()).map_err(io::Error::other)?,
            None => Record::default(),
        };
        if !record.applied.contains(&change.client_id) {
            let revision = record.preferences.revision;
            apply(&mut record.preferences, change.operation, initialized);
            record.preferences.revision = revision.saturating_add(1);
            record.applied.push(change.client_id);
            if record.applied.len() > 512 {
                record.applied.remove(0);
            }
        }
        let result = json!({"userId":user,"initialized":true,"preferences":record.preferences});
        map.insert(
            user.into(),
            serde_json::to_value(record).map_err(io::Error::other)?,
        );
        Ok(result)
    })
}
fn unavailable(error: impl std::fmt::Display) -> ApiError {
    tracing::warn!(%error, "sidebar preferences unavailable");
    ApiError::unavailable(
        "sidebar_preferences_unavailable",
        "Sidebar preferences could not be saved or loaded",
    )
}
async fn read(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> ApiResult {
    let result = tokio::task::spawn_blocking(move || read_user(&state.home, &principal.user_id))
        .await
        .map_err(unavailable)?
        .map_err(unavailable)?;
    Ok(success(result))
}
async fn write(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(change): Json<Change>,
) -> ApiResult {
    if change.user_id != principal.user_id {
        return Err(ApiError::forbidden(
            "Sidebar account changed; reload before saving",
        ));
    }
    if change.client_id.trim().is_empty() || change.client_id.len() > 200 {
        return Err(ApiError::bad(
            "clientId is required and must not exceed 200 bytes",
        ));
    }
    let result =
        tokio::task::spawn_blocking(move || write_user(&state.home, &principal.user_id, change))
            .await
            .map_err(unavailable)?
            .map_err(unavailable)?;
    Ok(success(result))
}
#[cfg(test)]
mod tests;
