//! Native Codex requests exposed through the existing generation-bound Web controls.
//! Only one-operation accept/decline/cancel; never session grants or policy amendments.
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io;

#[derive(Default)]
pub(super) struct Approvals {
    thread: Option<String>,
    closed: BTreeSet<String>,
    active: Option<(String, String)>,
    pending: BTreeMap<String, Value>,
    file_scopes: BTreeMap<String, Value>,
}
impl Approvals {
    pub(super) fn bind_thread(&mut self, thread: &str) {
        self.clear();
        self.thread = Some(thread.into());
    }
    pub(super) fn observe(&mut self, message: &Value) {
        if message["params"]["threadId"]
            .as_str()
            .is_some_and(|t| self.thread.as_deref() != Some(t))
        {
            return;
        }
        match message["method"].as_str() {
            Some("serverRequest/resolved")
                if message["params"]["threadId"].as_str() == self.thread.as_deref() =>
            {
                if let Some(id) = message["params"].get("requestId") {
                    self.pending.remove(&id.to_string());
                }
            }
            Some("turn/started") => {
                let next = message["params"]["threadId"]
                    .as_str()
                    .zip(message.pointer("/params/turn/id").and_then(Value::as_str))
                    .map(|(a, b)| (a.to_owned(), b.to_owned()));
                if next.as_ref().is_some_and(|(_, t)| self.closed.contains(t))
                    || next == self.active
                {
                    return;
                }
                self.pending.clear();
                self.file_scopes.clear();
                self.active = next;
            }
            Some("turn/completed")
                if message.pointer("/params/turn/id").and_then(Value::as_str)
                    == self.active.as_ref().map(|(_, t)| t.as_str()) =>
            {
                if let Some((_, t)) = self.active.take() {
                    self.closed.insert(t);
                }
                self.pending.clear();
                self.file_scopes.clear();
            }
            Some("item/started")
                if self
                    .active
                    .as_ref()
                    .is_some_and(|(_, t)| message["params"]["turnId"].as_str() == Some(t))
                    && message["params"]["item"]["type"] == "fileChange" =>
            {
                if let (Some(id), Some(changes)) = (
                    message["params"]["item"]["id"].as_str(),
                    message["params"]["item"]["changes"].as_array(),
                ) {
                    let complete = changes.len() <= 100
                        && changes.iter().all(|c| {
                            c["path"]
                                .as_str()
                                .is_some_and(|s| !s.is_empty() && s.len() <= 4096)
                                && matches!(
                                    c["kind"]["type"].as_str(),
                                    Some("add" | "delete" | "update")
                                )
                                && c["kind"]["move_path"]
                                    .as_str()
                                    .is_none_or(|s| s.len() <= 4096)
                        });
                    let scope: Vec<_> = if complete {
                        changes.iter().map(|c|json!({"path":c["path"],"kind":c["kind"]["type"],"move_path":c["kind"]["move_path"]})).collect()
                    } else {
                        Vec::new()
                    };
                    self.file_scopes
                        .insert(id.into(), json!({"paths":scope,"complete":complete}));
                }
            }
            _ => {}
        }
    }
    pub(super) fn supported(message: &Value) -> bool {
        matches!(
            message["method"].as_str(),
            Some("item/commandExecution/requestApproval" | "item/fileChange/requestApproval")
        )
    }
    pub(super) fn insert(&mut self, message: &Value) -> io::Result<bool> {
        let p = &message["params"];
        let pair = p["threadId"].as_str().zip(p["turnId"].as_str());
        if pair != self.active.as_ref().map(|(a, b)| (a.as_str(), b.as_str()))
            || pair.is_none()
            || message.get("id").is_none()
        {
            return Err(io::Error::other(
                "approval does not match active thread/turn",
            ));
        }
        let key = message["id"].to_string();
        if let Some(old) = self.pending.get(&key) {
            return if old == message {
                Ok(false)
            } else {
                Err(io::Error::other("conflicting approval request id"))
            };
        }
        self.pending.insert(key, message.clone());
        Ok(true)
    }
    fn details(&self, m: &Value) -> Value {
        let p = &m["params"];
        let mut d = json!({"thread_id":p["threadId"],"turn_id":p["turnId"],"item_id":p["itemId"]});
        if let Some(choices) = p["availableDecisions"].as_array() {
            // Project enum labels only: amendment payloads can contain sensitive data.
            let labels: Vec<_> = choices
                .iter()
                .take(16)
                .map(|v| {
                    let label = v.as_str().or_else(|| {
                        v.as_object()
                            .filter(|o| o.len() == 1)
                            .and_then(|o| o.keys().next().map(String::as_str))
                    });
                    match label {
                        Some(
                            name @ ("accept"
                            | "acceptForSession"
                            | "acceptWithExecpolicyAmendment"
                            | "applyNetworkPolicyAmendment"
                            | "decline"
                            | "cancel"),
                        ) => name,
                        _ => "unsupported",
                    }
                })
                .collect();
            d["available_decisions"] = json!(labels);
            d["available_decisions_truncated"] = json!(choices.len() > 16);
        }
        if let Some(reason) = p["reason"].as_str() {
            d["reason"] = json!(reason.chars().take(2000).collect::<String>());
        }
        if m["method"] == "item/commandExecution/requestApproval" {
            let complete = p["command"]
                .as_str()
                .is_some_and(|v| !v.is_empty() && v.len() <= 8192)
                && p["cwd"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty() && v.len() <= 4096);
            d["scope_complete"] = json!(complete);
            if complete {
                d["command"] = p["command"].clone();
                d["cwd"] = p["cwd"].clone();
            }
        } else {
            let scope = p["itemId"].as_str().and_then(|id| self.file_scopes.get(id));
            d["scope_complete"] =
                json!(scope.is_some_and(|v| v["complete"] == true
                    && v["paths"].as_array().is_some_and(|a| !a.is_empty())));
            if let Some(scope) = scope {
                d["file_changes"] = scope["paths"].clone();
            }
        }
        d
    }
    pub(super) fn visible(&self) -> Vec<Value> {
        self.pending.iter().map(|(id,m)| json!({"request_id":id,"kind":"permission","title":if m["method"] == "item/fileChange/requestApproval" {"Local file change approval"} else {"Local command approval"},"details":self.details(m)})).collect()
    }
    pub(super) fn take(&mut self, id: &str, allow: bool) -> io::Result<(Value, Value)> {
        let m = self.pending.get(id).ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "approval is no longer pending")
        })?;
        if allow && self.details(m)["scope_complete"] != true {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "complete operation scope is unavailable; cannot approve",
            ));
        }
        let available = &m["params"]["availableDecisions"];
        if !available.is_null() && !available.is_array() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "invalid provider decisions",
            ));
        }
        let choices = available.as_array();
        let offered =
            |decision: &str| choices.is_none_or(|a| a.iter().any(|v| v.as_str() == Some(decision)));
        let decision = if allow && offered("accept") {
            "accept"
        } else if !allow && offered("decline") {
            "decline"
        } else if !allow && choices.is_some() && offered("cancel") {
            "cancel"
        } else {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "decision not offered by provider",
            ));
        };
        let m = self.pending.remove(id).expect("checked pending");
        Ok((m["id"].clone(), json!({"decision":decision})))
    }
    pub(super) fn clear(&mut self) {
        self.pending.clear();
        self.file_scopes.clear();
        self.active = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn started() -> Value {
        json!({"method":"turn/started","params":{"threadId":"t","turn":{"id":"u"}}})
    }
    fn request() -> Value {
        json!({"id":17,"method":"item/commandExecution/requestApproval","params":{"threadId":"t","turnId":"u","itemId":"i","command":"pwd","cwd":"/fixture"}})
    }
    #[test]
    fn pending_is_bound_deduplicated_and_one_shot() {
        let mut a = Approvals::default();
        a.bind_thread("t");
        assert!(a.insert(&request()).is_err());
        a.observe(&started());
        assert!(a.insert(&request()).unwrap());
        assert!(!a.insert(&request()).unwrap());
        assert_eq!(a.visible().len(), 1);
        assert!(!a.visible()[0].to_string().contains("raw_frame"));
        let (id, r) = a.take("17", true).unwrap();
        assert_eq!(id, 17);
        assert_eq!(r, json!({"decision":"accept"}));
        assert!(a.take("17", true).is_err());
    }
    #[test]
    fn completion_disconnect_and_wrong_turn_never_leave_approval() {
        let mut a = Approvals::default();
        a.bind_thread("t");
        a.observe(&started());
        let mut r = request();
        r["params"]["turnId"] = json!("stale");
        assert!(a.insert(&r).is_err());
        a.insert(&request()).unwrap();
        a.observe(&json!({"method":"turn/completed","params":{"turn":{"id":"u"}}}));
        assert!(a.visible().is_empty());
        assert!(a.take("17", true).is_err());
        a = Approvals::default();
        a.bind_thread("t");
        a.observe(&started());
        a.insert(&request()).unwrap();
        a.clear();
        assert!(a.visible().is_empty());
    }
    #[test]
    fn deny_prefers_decline_then_cancel_and_is_one_shot() {
        for (choices, expected) in [
            (json!(["cancel"]), "cancel"),
            (json!(["cancel", "decline"]), "decline"),
        ] {
            let mut a = Approvals::default();
            a.bind_thread("t");
            a.observe(&started());
            let mut r = request();
            r["params"]["availableDecisions"] = choices;
            a.insert(&r).unwrap();
            assert_eq!(
                a.take("17", false).unwrap(),
                (json!(17), json!({"decision": expected}))
            );
            assert!(a.take("17", false).is_err());
        }
    }
    #[test]
    fn session_and_amendment_choices_never_grant_or_consume() {
        for choices in [
            json!([]),
            json!({"cancel":true}),
            json!(["acceptForSession", {"acceptWithExecpolicyAmendment": {"secret": "never expose"}}]),
        ] {
            let mut a = Approvals::default();
            a.bind_thread("t");
            a.observe(&started());
            let mut r = request();
            r["params"]["availableDecisions"] = choices;
            a.insert(&r).unwrap();
            assert!(a.take("17", true).is_err());
            assert!(a.take("17", false).is_err());
            assert_eq!(a.visible().len(), 1);
            assert!(!json!(a.visible()).to_string().contains("never expose"));
        }
    }
    #[test]
    fn offered_details_are_bounded_enum_labels_without_payloads() {
        let mut a = Approvals::default();
        a.bind_thread("t");
        a.observe(&started());
        let mut r = request();
        let mut choices = vec![
            json!("cancel"),
            json!({"acceptWithExecpolicyAmendment":{"secret":"never expose"}}),
            json!("untrusted secret"),
        ];
        choices.extend((0..20).map(|_| json!("decline")));
        r["params"]["availableDecisions"] = json!(choices);
        a.insert(&r).unwrap();
        let details = a.visible()[0]["details"].clone();
        assert_eq!(details["available_decisions"].as_array().unwrap().len(), 16);
        assert_eq!(details["available_decisions"][0], "cancel");
        assert_eq!(
            details["available_decisions"][1],
            "acceptWithExecpolicyAmendment"
        );
        assert_eq!(details["available_decisions"][2], "unsupported");
        assert_eq!(details["available_decisions_truncated"], true);
        assert!(!details.to_string().contains("secret"));
    }
    #[test]
    fn unavailable_decision_stays_pending() {
        let mut a = Approvals::default();
        a.bind_thread("t");
        a.observe(&started());
        let mut r = request();
        r["params"]["availableDecisions"] = json!(["decline"]);
        a.insert(&r).unwrap();
        assert!(a.take("17", true).is_err());
        assert_eq!(a.visible().len(), 1);
        assert!(a.take("17", false).is_ok());
    }
}

#[cfg(test)]
mod scope_regressions {
    use super::*;
    #[test]
    fn native_client_resolution_removes_only_the_matching_request() {
        let mut a = Approvals::default();
        a.bind_thread("t");
        a.observe(&json!({"method":"turn/started","params":{"threadId":"t","turn":{"id":"u"}}}));
        for id in [1, 2] {
            a.insert(&json!({"id":id,"method":"item/commandExecution/requestApproval","params":{"threadId":"t","turnId":"u","itemId":"i","command":"pwd","cwd":"/fixture"}})).unwrap();
        }
        a.observe(
            &json!({"method":"serverRequest/resolved","params":{"threadId":"child","requestId":1}}),
        );
        assert_eq!(a.visible().len(), 2);
        a.observe(
            &json!({"method":"serverRequest/resolved","params":{"threadId":"t","requestId":1}}),
        );
        assert_eq!(a.visible().len(), 1);
        assert!(a.take("1", true).is_err());
        assert!(a.take("2", false).is_ok());
    }
    #[test]
    fn foreign_and_duplicate_starts_preserve_parent_and_closed_turn_stays_closed() {
        let mut a = Approvals::default();
        a.bind_thread("t");
        let start = json!({"method":"turn/started","params":{"threadId":"t","turn":{"id":"u"}}});
        let req = json!({"id":1,"method":"item/commandExecution/requestApproval","params":{"threadId":"t","turnId":"u","itemId":"i","command":"pwd","cwd":"/fixture","reason":"diagnostic","raw_secret":"never expose"}});
        a.observe(&start);
        a.insert(&req).unwrap();
        a.observe(&start);
        a.observe(&json!({"method":"turn/started","params":{"threadId":"child","turn":{"id":"child-turn"}}}));
        assert_eq!(a.visible().len(), 1);
        assert_eq!(a.visible()[0]["details"]["command"], "pwd");
        assert!(!json!(a.visible()).to_string().contains("raw_secret"));
        a.observe(&json!({"method":"turn/completed","params":{"threadId":"t","turn":{"id":"u"}}}));
        a.observe(&start);
        assert!(a.insert(&req).is_err());
    }
    #[test]
    fn missing_scope_cannot_be_accepted_but_can_be_denied() {
        let mut a = Approvals::default();
        a.bind_thread("t");
        a.observe(&json!({"method":"turn/started","params":{"threadId":"t","turn":{"id":"u"}}}));
        a.insert(&json!({"id":2,"method":"item/fileChange/requestApproval","params":{"threadId":"t","turnId":"u","itemId":"f"}})).unwrap();
        assert!(a.take("2", true).is_err());
        assert!(a.take("2", false).is_ok());
    }
}
