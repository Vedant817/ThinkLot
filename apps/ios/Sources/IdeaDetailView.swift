import Combine
import ConvexMobile
import SwiftUI

struct IdeaDetailView: View {
    @EnvironmentObject private var store: ThinkLotStore
    @Environment(\.dismiss) private var dismiss
    let ideaId: String
    @State private var detail: IdeaDetail?
    @State private var unavailable = false
    @State private var error: String?
    @State private var editing = false
    @State private var deleting = false
    @State private var taskTitle = ""
    @State private var editTask: IdeaTask?
    @State private var editedTaskTitle = ""
    @State private var retry = 0
    var body: some View {
        Group {
            if let detail {
                Form {
                    Section(detail.idea.plate) {
                        Text(detail.idea.title).font(.title2.bold())
                        if let description = detail.idea.description { Text(description) }
                        if let problem = detail.idea.problem { Text("Problem: \(problem)") }
                        Text(detail.idea.tags.joined(separator: " · ")).foregroundStyle(.secondary)
                        if let priority = detail.idea.priority { Text("Priority \(priority, specifier: "%.1f")") }
                        if let revisit = detail.idea.revisitAt { Text("Revisit \(Date(timeIntervalSince1970: revisit / 1000).formatted(date: .abbreviated, time: .omitted))") }
                        Button("Edit details and scoring") { editing = true }
                    }
                    Section("Lifecycle") {
                        Menu("Stage: \(detail.idea.status.label)") {
                            ForEach(Lifecycle.allCases) { stage in
                                Button(stage.label) { Task { await store.mutate("ideas:setStatus", ["ideaId": ideaId, "status": stage.rawValue]) } }
                            }
                        }
                        Button(detail.idea.favorite ? "Remove favorite" : "Favorite", systemImage: detail.idea.favorite ? "star.fill" : "star") {
                            Task { await store.mutate("ideas:toggleFavorite", ["ideaId": ideaId]) }
                        }
                        Button(detail.idea.archived ? "Restore to Inbox" : "Archive") {
                            Task { await store.mutate("ideas:setArchived", ["ideaId": ideaId, "archived": !detail.idea.archived]) }
                        }
                        Menu("Snooze review") {
                            ForEach([1, 7, 30], id: \.self) { days in
                                Button("\(days) days") { Task { await store.mutate("review:snooze", ["ideaId": ideaId, "days": Double(days)]) } }
                            }
                        }
                    }
                    Section("Tasks") {
                        if !detail.tasks.isEmpty {
                            let completed = detail.tasks.filter(\.completed).count
                            ProgressView(value: Double(completed), total: Double(detail.tasks.count))
                            Text("\(completed) of \(detail.tasks.count) completed").font(.caption)
                        }
                        ForEach(detail.tasks) { task in
                            HStack {
                                Button { Task { await store.mutate("tasks:toggleTask", ["taskId": task.id]) } } label: {
                                    Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                                }.accessibilityLabel(task.completed ? "Mark incomplete" : "Complete task")
                                Text(task.title).strikethrough(task.completed)
                                Spacer()
                                Menu {
                                    Button("Rename") { editedTaskTitle = task.title; editTask = task }
                                    Button("Delete", role: .destructive) { Task { await store.mutate("tasks:removeTask", ["taskId": task.id]) } }
                                } label: { Image(systemName: "ellipsis") }.accessibilityLabel("Task actions")
                            }.buttonStyle(.borderless)
                        }
                        TextField("Next action", text: $taskTitle)
                        Button("Add task") {
                            Task { if await store.mutate("tasks:addTask", ["ideaId": ideaId, "title": taskTitle]) { taskTitle = "" } }
                        }.disabled(taskTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || taskTitle.count > 200)
                    }
                    Section { Button("Delete idea", role: .destructive) { deleting = true } }
                }.disabled(store.busy)
            } else if unavailable {
                ContentUnavailableView("Idea unavailable", systemImage: "tray", description: Text("It may have been deleted or belong to another account."))
            } else if let error {
                VStack { Text(error); Button("Retry") { self.error = nil; retry += 1 } }.padding()
            } else { ProgressView("Loading idea…") }
        }
        .navigationTitle("Idea").navigationBarTitleDisplayMode(.inline)
        .task(id: retry) {
            do {
                for try await value in store.client.subscribe(to: "ideas:get", with: ["ideaId": ideaId], yielding: IdeaDetail?.self).values {
                    detail = value; unavailable = value == nil
                }
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .sheet(isPresented: $editing) { if let detail { IdeaEditor(idea: detail.idea).environmentObject(store) } }
        .alert("Rename task", isPresented: Binding(get: { editTask != nil }, set: { if !$0 { editTask = nil } })) {
            TextField("Task", text: $editedTaskTitle)
            Button("Save") {
                if let task = editTask { Task { await store.mutate("tasks:updateTask", ["taskId": task.id, "title": editedTaskTitle]) } }
                editTask = nil
            }
            Button("Cancel", role: .cancel) { editTask = nil }
        }
        .confirmationDialog("Delete this idea and its tasks permanently?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete idea", role: .destructive) { Task { if await store.mutate("ideas:remove", ["ideaId": ideaId]) { dismiss() } } }
        }
    }
}

struct IdeaEditor: View {
    @EnvironmentObject private var store: ThinkLotStore
    @Environment(\.dismiss) private var dismiss
    let idea: Idea
    @State private var title: String
    @State private var description: String
    @State private var problem: String
    @State private var tags: String
    @State private var impact: Double
    @State private var effort: Double
    @State private var confidence: Double
    @State private var scored: Bool
    @State private var revisit: Date
    @State private var hasRevisit: Bool
    init(idea: Idea) {
        self.idea = idea
        _title = State(initialValue: idea.title)
        _description = State(initialValue: idea.description ?? "")
        _problem = State(initialValue: idea.problem ?? "")
        _tags = State(initialValue: idea.tags.joined(separator: ", "))
        _impact = State(initialValue: idea.impact ?? 5)
        _effort = State(initialValue: idea.effort ?? 5)
        _confidence = State(initialValue: idea.confidence ?? 5)
        _scored = State(initialValue: idea.priority != nil)
        _revisit = State(initialValue: Date(timeIntervalSince1970: (idea.revisitAt ?? Date().timeIntervalSince1970 * 1000) / 1000))
        _hasRevisit = State(initialValue: idea.revisitAt != nil)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Details") {
                    TextField("Title", text: $title, axis: .vertical)
                    TextField("Description", text: $description, axis: .vertical).lineLimit(3...8)
                    TextField("Problem", text: $problem, axis: .vertical).lineLimit(2...6)
                    TextField("Tags, separated by commas", text: $tags).textInputAutocapitalization(.never)
                }
                Section("Priority") {
                    Toggle("Score this idea", isOn: $scored)
                    if scored {
                        Stepper("Impact: \(Int(impact))", value: $impact, in: 1...10, step: 1)
                        Stepper("Effort: \(Int(effort))", value: $effort, in: 1...10, step: 1)
                        Stepper("Confidence: \(Int(confidence))", value: $confidence, in: 1...10, step: 1)
                        Text("Priority \(impact * confidence / effort, specifier: "%.1f")")
                    }
                }
                Section("Revisit") {
                    Toggle("Set a revisit date", isOn: $hasRevisit)
                    if hasRevisit { DatePicker("Date", selection: $revisit, displayedComponents: .date) }
                }
                if let error = store.error { Text(error).foregroundStyle(.red) }
            }.navigationTitle("Edit idea")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(store.busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let tagValues = tags.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) } as [ConvexEncodable?]
                            let args: [String: ConvexEncodable?] = [
                                "ideaId": idea.id, "title": title,
                                "description": description.isEmpty ? nil : description,
                                "problem": problem.isEmpty ? nil : problem, "tags": tagValues,
                                "impact": scored ? impact : nil, "effort": scored ? effort : nil,
                                "confidence": scored ? confidence : nil,
                                "revisitAt": hasRevisit ? (revisit.timeIntervalSince1970 * 1000).rounded() : nil
                            ]
                            if await store.mutate("ideas:update", args) { dismiss() }
                        }
                    }.disabled(store.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 300 || description.count > 20000 || problem.count > 20000)
                }
            }
        }
    }
}
